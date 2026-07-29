// src/actions/staff-dashboard.ts
"use server";

import { prisma } from "@/lib/prisma";
import { authorizeStaff } from "@/lib/staff-guard";
import { isDbConnectionError } from "@/lib/db-errors";
import { getCampaignConfig } from "@/lib/campaign-rules.server";
import { clampCycleCount } from "@/lib/campaign-rules";
import type { Prisma } from "@/generated/prisma/client";

// ─── Tuning ───────────────────────────────────────────────────────────────────
/** Rows in the activity feed. Enough to fill a glance, short enough to scan. */
const ACTIVITY_LIMIT = 12;

/** How many stamps away still counts as "close to a reward". */
const NEAR_REWARD_DISTANCE = 2;

/**
 * Upper bound on candidates returned to the client. The UI shows the first
 * few and reveals the rest behind "tümünü gör" without a second round-trip.
 */
const NEAR_REWARD_LIMIT = 25;

// ─── Branch scoping ───────────────────────────────────────────────────────────
/**
 * Both readers below are Server Actions — reachable by their action id from
 * anywhere, not just from the /staff page middleware already gates. So the
 * session is re-read here and the branch filter is built from the *session*,
 * never from a client-supplied argument.
 *
 * A STAFF user is pinned to their own branch. `branchId` is nullable on User,
 * and `addOrder` writes `session.user.branchId ?? null` onto the Order, so an
 * unassigned staffer matching `branchId: null` sees exactly the rows they
 * created — the filter stays correct without a special case.
 *
 * An ADMIN without a branch is the one exception: they are not "a branch's
 * cashier", so they get the unfiltered view rather than the empty
 * `branchId: null` slice.
 */
type Scope =
  | {
      ok: true;
      orderWhere: Prisma.OrderWhereInput;
      customerWhere: Prisma.CustomerWhereInput;
      /**
       * True only for the unfiltered ADMIN view, i.e. the result set may mix
       * branches. The UI uses this to decide whether a branch label carries
       * information — inside a single branch it is noise on every row.
       */
      crossBranch: boolean;
    }
  | { ok: false; error: string };

async function resolveScope(): Promise<Scope> {
  // Role AND branch come from the database row, not the JWT. A staffer moved
  // to a different branch would otherwise keep reading their old branch's
  // customer list until their token expired.
  const guard = await authorizeStaff();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { staff } = guard;

  const branchId = staff.branchId;
  const unscopedAdmin = staff.isAdmin && branchId === null;

  return {
    ok: true,
    orderWhere: unscopedAdmin ? {} : { branchId },
    customerWhere: unscopedAdmin ? {} : { branchId },
    crossBranch: unscopedAdmin,
  };
}

// ─── Feature 1: Recent activity feed ──────────────────────────────────────────
export interface ActivityItem {
  id: string;
  /** ISO string — Date instances are re-serialised per call, strings are stable. */
  createdAt: string;

  // ── WHO THE STAMP BELONGS TO (primary line) ──────────────────────────────
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerQrUuid: string;

  // ── WHO PERFORMED IT (secondary line) ────────────────────────────────────
  /** null when the staff account was deleted (Order.staffId is SetNull). */
  staffName: string | null;
  /** null when the branch was deleted (Order.branchId is SetNull) or unset. */
  branchName: string | null;

  /**
   * Stamp delta this row represents. Always +1 today: an Order row IS a stamp,
   * and `removeStamp` DELETES the row rather than writing a -1 correction, so
   * no negative row can exist to be read back. Kept explicit so the UI does not
   * hardcode the sign and so a future audit-log model can emit -1 here.
   */
  delta: 1;

  /** Set when this exact order also granted a reward. */
  rewardName: string | null;
}

export type RecentActivityResult =
  | { success: true; items: ActivityItem[]; crossBranch: boolean }
  | { success: false; error: string };

/**
 * The last {@link ACTIVITY_LIMIT} stamps given at the caller's branch, newest
 * first.
 *
 * One query, served by the existing `@@index([branchId, createdAt(sort: Desc)])`
 * on `orders` — the `take` is applied by Postgres, so the row count is bounded
 * regardless of how large the table grows. The `id` tie-break rides on top of
 * the indexed `createdAt` ordering and only sorts within an identical
 * timestamp, so it does not cost the index scan. Customer/staff/branch/reward
 * come along as selected relations rather than N+1 follow-up lookups.
 */
export async function getRecentActivity(): Promise<RecentActivityResult> {
  const scope = await resolveScope();
  if (!scope.ok) return { success: false, error: scope.error };

  try {
    const orders = await prisma.order.findMany({
      where: scope.orderWhere,
      // Strictly newest-first. `id` is a secondary key only to break ties:
      // two cashiers stamping inside the same millisecond would otherwise get
      // an unstable order, which makes rows visibly swap places between polls.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LIMIT,
      select: {
        id: true,
        createdAt: true,
        customer: {
          select: { id: true, name: true, phone: true, qrUuid: true },
        },
        // The staff member who performed the stamp — NOT the customer. These
        // are two different people and the UI must never conflate them.
        staff: { select: { name: true } },
        branch: { select: { name: true } },
        reward: { select: { rule: { select: { rewardName: true } } } },
      },
    });

    return {
      success: true,
      crossBranch: scope.crossBranch,
      items: orders.map((order) => ({
        id: order.id,
        createdAt: order.createdAt.toISOString(),
        customerId: order.customer.id,
        customerName: order.customer.name,
        customerPhone: order.customer.phone,
        customerQrUuid: order.customer.qrUuid,
        staffName: order.staff?.name ?? null,
        branchName: order.branch?.name ?? null,
        delta: 1 as const,
        rewardName: order.reward?.rule.rewardName ?? null,
      })),
    };
  } catch (error) {
    console.error("[getRecentActivity] Error:", error);

    if (isDbConnectionError(error)) {
      return {
        success: false,
        error: "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin.",
      };
    }

    return { success: false, error: "Son işlemler yüklenemedi." };
  }
}

// ─── Feature 2: Customers close to a reward ───────────────────────────────────
export interface NearRewardCustomer {
  id: string;
  name: string;
  phone: string;
  qrUuid: string;
  currentCycleCount: number;
  /** The next active threshold this customer will hit. */
  nextThreshold: number;
  nextRewardName: string;
  /** nextThreshold - currentCycleCount. Always 1..NEAR_REWARD_DISTANCE. */
  remaining: number;
}

export type NearRewardResult =
  | { success: true; customers: NearRewardCustomer[] }
  | { success: false; error: string };

/**
 * Customers at this branch sitting within {@link NEAR_REWARD_DISTANCE} stamps
 * of their next campaign threshold, closest first.
 *
 * The naive version of this ("load the branch's customers, work out each one's
 * next threshold in JS") scans the whole table. This one inverts the problem:
 * for a threshold T, the *only* cycle counts that are `d` stamps away are
 * `T - d`. Active thresholds are a handful of integers, so the qualifying
 * counts are a handful of integers too — and each distance gets its own narrow
 * `currentCycleCount: { in: [...] }` query.
 *
 * Two payoffs: Postgres does the filtering against a tiny IN-list (and applies
 * `take`), and issuing one query per distance means the concatenated result is
 * *already* sorted by "fewest stamps remaining" without an in-memory sort that
 * a `take` could have truncated incorrectly.
 *
 * A count that two thresholds could claim (e.g. count 5 with thresholds 6 and
 * 7) is assigned to the nearest one only, so nobody appears twice and the
 * reward shown is the one they will actually hit next.
 */
export async function getCustomersNearReward(): Promise<NearRewardResult> {
  const scope = await resolveScope();
  if (!scope.ok) return { success: false, error: scope.error };

  try {
    const { rules } = await getCampaignConfig();

    // No campaign configured ⇒ there is no "next reward" to be close to.
    if (rules.length === 0) return { success: true, customers: [] };

    // count → the nearest threshold that count is approaching.
    // Rules arrive ascending by threshold; iterating distance-first means a
    // closer threshold always claims a count before a farther one can.
    const targetByCount = new Map<
      number,
      { threshold: number; rewardName: string; remaining: number }
    >();

    for (let remaining = 1; remaining <= NEAR_REWARD_DISTANCE; remaining++) {
      for (const rule of rules) {
        const count = rule.threshold - remaining;
        // count 0 would sweep in every customer who has never ordered — the
        // section is meant to flag momentum, not list the whole branch.
        if (count <= 0) continue;
        if (targetByCount.has(count)) continue;
        targetByCount.set(count, {
          threshold: rule.threshold,
          rewardName: rule.rewardName,
          remaining,
        });
      }
    }

    if (targetByCount.size === 0) return { success: true, customers: [] };

    // Group the qualifying counts by distance so each bucket is one query.
    const countsByDistance = new Map<number, number[]>();
    for (const [count, target] of targetByCount) {
      const bucket = countsByDistance.get(target.remaining);
      if (bucket) bucket.push(count);
      else countsByDistance.set(target.remaining, [count]);
    }

    const distances = [...countsByDistance.keys()].sort((a, b) => a - b);

    const buckets = await Promise.all(
      distances.map((distance) =>
        prisma.customer.findMany({
          where: {
            ...scope.customerWhere,
            isActive: true,
            currentCycleCount: { in: countsByDistance.get(distance)! },
          },
          // Most recently active first within a distance bucket — the person
          // who was just here is the one the cashier is most likely to see.
          orderBy: { updatedAt: "desc" },
          take: NEAR_REWARD_LIMIT,
          select: {
            id: true,
            name: true,
            phone: true,
            qrUuid: true,
            currentCycleCount: true,
          },
        })
      )
    );

    const customers: NearRewardCustomer[] = [];

    // Buckets are concatenated in ascending-distance order, so the final list
    // is sorted by "closest to reward" by construction.
    for (const bucket of buckets) {
      for (const customer of bucket) {
        if (customers.length >= NEAR_REWARD_LIMIT) break;

        const target = targetByCount.get(customer.currentCycleCount);
        // Defensive: an admin editing thresholds between the rule read and the
        // customer read could leave a row without a match. Skip rather than
        // render a nonsensical "0 pul kaldı".
        if (!target) continue;

        customers.push({
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          qrUuid: customer.qrUuid,
          // Guard against a stranded legacy count sitting above the active
          // threshold, exactly as the card surfaces do.
          currentCycleCount: clampCycleCount(
            customer.currentCycleCount,
            target.threshold
          ),
          nextThreshold: target.threshold,
          nextRewardName: target.rewardName,
          remaining: target.remaining,
        });
      }
    }

    return { success: true, customers };
  } catch (error) {
    console.error("[getCustomersNearReward] Error:", error);

    if (isDbConnectionError(error)) {
      return {
        success: false,
        error: "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin.",
      };
    }

    return { success: false, error: "Ödüle yaklaşan müşteriler yüklenemedi." };
  }
}
