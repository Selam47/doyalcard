"use server";

import { prisma } from "@/lib/prisma";
import { authorizeStaff } from "@/lib/staff-guard";
import { isDbConnectionError } from "@/lib/db-errors";
import { getCampaignConfig } from "@/lib/campaign-rules.server";
import { clampCycleCount } from "@/lib/campaign-rules";
import type { Prisma } from "@/generated/prisma/client";

/** Rows in the activity feed. Enough to fill a glance, short enough to scan. */
const ACTIVITY_LIMIT = 12;

/** How many stamps away still counts as "close to a reward". */
const NEAR_REWARD_DISTANCE = 2;

/**
 * Upper bound on candidates returned to the client. The UI shows the first
 * few and reveals the rest behind "tümünü gör" without a second round-trip.
 */
const NEAR_REWARD_LIMIT = 25;

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

export interface ActivityItem {
  id: string;
  /** ISO string — Date instances are re-serialised per call, strings are stable. */
  createdAt: string;

  customerId: string;
  customerName: string;
  customerPhone: string;
  customerQrUuid: string;

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
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_LIMIT,
      select: {
        id: true,
        createdAt: true,
        customer: {
          select: { id: true, name: true, phone: true, qrUuid: true },
        },
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
 * All of those counts go into ONE query, and the "fewest stamps remaining"
 * ordering is applied afterwards in memory. The row budget is deliberately
 * LIMIT × distances rather than LIMIT, so the sort has enough candidates that
 * a customer 1 stamp away cannot be crowded out by more-recently-seen
 * customers 2 stamps away before the final slice.
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

    if (rules.length === 0) return { success: true, customers: [] };

    const targetByCount = new Map<
      number,
      { threshold: number; rewardName: string; remaining: number }
    >();

    for (let remaining = 1; remaining <= NEAR_REWARD_DISTANCE; remaining++) {
      for (const rule of rules) {
        const count = rule.threshold - remaining;
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

    /*
     * ONE query for every distance, not one per distance.
     *
     * Every qualifying cycle count — across all distances — goes into a single
     * IN-list. Postgres still does the filtering against a handful of integers;
     * we just stop paying a round trip per distance bucket on a page that every
     * open till re-polls on a timer.
     *
     * The over-fetch is the part that matters. Taking only NEAR_REWARD_LIMIT
     * rows here would reintroduce exactly the bug the per-bucket version was
     * written to avoid: ordered by recency alone, 25 customers sitting 2 stamps
     * away could fill the window and push out someone 1 stamp away — the person
     * the cashier most needs to see. Fetching LIMIT × distances rows and
     * sorting by `remaining` afterwards keeps the closest customers in, and the
     * upper bound stays small and fixed.
     */
    const allCounts = [...targetByCount.keys()];
    const distanceCount = new Set(
      [...targetByCount.values()].map((t) => t.remaining)
    ).size;

    const rows = await prisma.customer.findMany({
      where: {
        ...scope.customerWhere,
        isActive: true,
        currentCycleCount: { in: allCounts },
      },
      orderBy: { updatedAt: "desc" },
      take: NEAR_REWARD_LIMIT * Math.max(distanceCount, 1),
      select: {
        id: true,
        name: true,
        phone: true,
        qrUuid: true,
        currentCycleCount: true,
      },
    });

    const customers: NearRewardCustomer[] = [];

    for (const customer of rows) {
      const target = targetByCount.get(customer.currentCycleCount);
      if (!target) continue;

      customers.push({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        qrUuid: customer.qrUuid,
        currentCycleCount: clampCycleCount(
          customer.currentCycleCount,
          target.threshold
        ),
        nextThreshold: target.threshold,
        nextRewardName: target.rewardName,
        remaining: target.remaining,
      });
    }

    // Closest to a reward first. Array.prototype.sort is stable, so customers
    // at the same distance keep the `updatedAt desc` order Postgres returned.
    customers.sort((a, b) => a.remaining - b.remaining);

    return { success: true, customers: customers.slice(0, NEAR_REWARD_LIMIT) };
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
