// src/actions/order.ts
"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { isDbConnectionError } from "@/lib/db-errors";
import { revalidateStampSurfaces } from "@/lib/revalidate";
import {
  clampCycleCount,
  pickCycleRule,
  resolveMaxStamps,
  type ActiveCampaignRule,
} from "@/lib/campaign-rules";

const TX_OPTIONS = {
  maxWait: 5000, // max time to wait for a transaction slot
  timeout: 10000, // max time for the transaction to complete
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
} as const;

const RULE_SELECT = {
  id: true,
  threshold: true,
  rewardName: true,
  isResetPoint: true,
} as const;

export type AddOrderResult =
  | {
      success: true;
      /** Cycle count AFTER any reset. */
      newCycleCount: number;
      /** Cumulative historical order/stamp count ("Toplam Sipariş"). */
      lifetimeCount: number;
      /** Active threshold this order was evaluated against. */
      maxStamps: number;
      reward?: { rewardName: string; isResetPoint: boolean };
    }
  | { success: false; error: string };

/**
 * Add +1 order ("+1 Etli Ekmek Siparişi") for a customer.
 *
 * Flow (all inside one transaction):
 *  1. Read the customer's counters.
 *  2. Read the ACTIVE campaign rules and derive `maxStamps` from the single
 *     active cycle rule — never from the customer row, never hardcoded.
 *  3. current_cycle_count += 1 AND lifetime_count += 1.
 *  4. If the new cycle count REACHES maxStamps (>=, not ==) grant the cycle
 *     reward as PENDING and reset current_cycle_count to 0.
 *     Using `>=` is what self-heals legacy rows that were left stranded above
 *     a since-lowered threshold (e.g. stuck on 12 while the campaign is 7):
 *     with `==` they could never match again and never reset.
 *  5. Otherwise, if the new count exactly hits a non-reset milestone rule,
 *     grant that milestone reward. (A Reward is 1:1 with an Order, so at most
 *     one reward can be created per order.)
 */
export async function addOrder(customerId: string): Promise<AddOrderResult> {
  // ─── 1. Authentication & Authorization ─────────────────────────────────────
  const session = await auth();
  if (!session?.user || !["STAFF", "ADMIN"].includes(session.user.role)) {
    return { success: false, error: "Yetkisiz erişim" };
  }

  // ─── 2. Input Validation ───────────────────────────────────────────────────
  if (!customerId || typeof customerId !== "string") {
    return { success: false, error: "Geçersiz müşteri kimliği" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // ─── 3. Verify Customer Exists ───────────────────────────────────────
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          qrUuid: true,
          currentCycleCount: true,
          lifetimeCount: true,
        },
      });

      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      // ─── 4. Resolve maxStamps From The ACTIVE Campaign Rule ──────────────
      const activeRules: ActiveCampaignRule[] = await tx.campaignRule.findMany({
        where: { isActive: true },
        orderBy: { threshold: "asc" },
        select: RULE_SELECT,
      });

      const cycleRule = pickCycleRule(activeRules);
      const maxStamps = resolveMaxStamps(cycleRule);

      // ─── 5. Compute New Counts ───────────────────────────────────────────
      // Normalize a stranded legacy value first so the increment lands inside
      // the currently active cycle instead of drifting further out of range.
      const baseCycleCount = Math.min(
        Math.max(0, customer.currentCycleCount),
        maxStamps
      );
      const nextCycleCount = baseCycleCount + 1;
      const nextLifetimeCount = Math.max(0, customer.lifetimeCount) + 1;

      // ─── 6. Cycle Completion vs. Milestone ───────────────────────────────
      // A cycle can only complete if an active rule actually exists — a Reward
      // row requires a ruleId, so with no configured campaign we simply keep
      // counting rather than resetting silently.
      const cycleCompleted = cycleRule !== null && nextCycleCount >= maxStamps;

      const matchedRule = cycleCompleted
        ? cycleRule
        : activeRules.find((r) => r.threshold === nextCycleCount) ?? null;

      const finalCycleCount = cycleCompleted ? 0 : nextCycleCount;

      // ─── 7. Create Order Record ──────────────────────────────────────────
      const order = await tx.order.create({
        data: {
          customerId: customer.id,
          branchId: session.user.branchId ?? null,
          staffId: session.user.id,
        },
      });

      // ─── 8. Create Reward (If Any Rule Matched) ──────────────────────────
      if (matchedRule) {
        await tx.reward.create({
          data: {
            customerId: customer.id,
            ruleId: matchedRule.id,
            orderId: order.id,
            status: "PENDING",
          },
        });
      }

      // ─── 9. Update Customer Counters ─────────────────────────────────────
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          currentCycleCount: finalCycleCount,
          lifetimeCount: nextLifetimeCount,
        },
      });

      return {
        qrUuid: customer.qrUuid,
        newCycleCount: finalCycleCount,
        lifetimeCount: nextLifetimeCount,
        maxStamps,
        reward: matchedRule
          ? {
              rewardName: matchedRule.rewardName,
              // Report the *effective* behaviour: the cycle really did reset.
              isResetPoint: cycleCompleted,
            }
          : undefined,
      };
    }, TX_OPTIONS);

    // ─── 10. Revalidate Every Stamp Surface ────────────────────────────────
    revalidateStampSurfaces(result.qrUuid);

    const { qrUuid: _qrUuid, ...payload } = result;
    void _qrUuid;
    return { success: true, ...payload };
  } catch (error) {
    // ─── 11. Error Handling ────────────────────────────────────────────────
    console.error("[addOrder] Error:", error);

    if (error instanceof Error) {
      if (error.message === "CUSTOMER_NOT_FOUND") {
        return { success: false, error: "Müşteri bulunamadı" };
      }
      if (error.message.includes("Unique constraint")) {
        return { success: false, error: "Bu sipariş zaten kaydedildi" };
      }
    }

    if (isDbConnectionError(error)) {
      return {
        success: false,
        error: "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin.",
      };
    }

    return { success: false, error: "Sipariş eklenemedi. Lütfen tekrar deneyin." };
  }
}

export type RemoveStampResult =
  | {
      success: true;
      newCycleCount: number;
      lifetimeCount: number;
      maxStamps: number;
    }
  | { success: false; error: string };

/**
 * Manual correction ("-1 Damga Düzeltme") — Staff/Admin only.
 * Used to undo a cashier double-tap / mis-scan.
 *
 * Both counters move so the history stays truthful:
 *  - current_cycle_count -= 1 (floor 0)
 *  - lifetime_count      -= 1 (floor 0)  ← "Toplam Sipariş"
 *
 * The most recent Order row is deleted too, but ONLY when no Reward is
 * attached to it, so `orders.count()` on the admin dashboard stays in sync
 * without ever orphaning or silently voiding an already-granted reward.
 * A stranded legacy cycle count is normalized against the active threshold
 * on the way down, so a correction can never leave the card above maxStamps.
 */
export async function removeStamp(
  customerId: string
): Promise<RemoveStampResult> {
  // ─── 1. Authentication & Authorization ─────────────────────────────────────
  const session = await auth();
  if (!session?.user || !["STAFF", "ADMIN"].includes(session.user.role)) {
    return { success: false, error: "Yetkisiz erişim" };
  }

  // ─── 2. Input Validation ───────────────────────────────────────────────────
  if (!customerId || typeof customerId !== "string") {
    return { success: false, error: "Geçersiz müşteri kimliği" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // ─── 3. Verify Customer Exists ───────────────────────────────────────
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          qrUuid: true,
          currentCycleCount: true,
          lifetimeCount: true,
        },
      });

      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");

      // ─── 4. Resolve maxStamps From The ACTIVE Campaign Rule ──────────────
      const activeRules: ActiveCampaignRule[] = await tx.campaignRule.findMany({
        where: { isActive: true },
        orderBy: { threshold: "asc" },
        select: RULE_SELECT,
      });
      const maxStamps = resolveMaxStamps(pickCycleRule(activeRules));

      // ─── 5. Compute New Counts (never below 0) ───────────────────────────
      const baseCycleCount = clampCycleCount(customer.currentCycleCount, maxStamps);
      const newCycleCount = Math.max(0, baseCycleCount - 1);
      const newLifetimeCount = Math.max(0, customer.lifetimeCount - 1);

      // ─── 6. Remove The Latest Reward-Free Order ──────────────────────────
      const lastOrder = await tx.order.findFirst({
        where: { customerId: customer.id, reward: { is: null } },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });

      if (lastOrder) {
        await tx.order.delete({ where: { id: lastOrder.id } });
      }

      // ─── 7. Update Customer Counters ─────────────────────────────────────
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          currentCycleCount: newCycleCount,
          lifetimeCount: newLifetimeCount,
        },
      });

      return {
        qrUuid: customer.qrUuid,
        newCycleCount,
        lifetimeCount: newLifetimeCount,
        maxStamps,
      };
    }, TX_OPTIONS);

    // ─── 8. Revalidate Every Stamp Surface ─────────────────────────────────
    revalidateStampSurfaces(result.qrUuid);

    const { qrUuid: _qrUuid, ...payload } = result;
    void _qrUuid;
    return { success: true, ...payload };
  } catch (error) {
    // ─── 9. Error Handling ─────────────────────────────────────────────────
    console.error("[removeStamp] Error:", error);

    if (error instanceof Error && error.message === "CUSTOMER_NOT_FOUND") {
      return { success: false, error: "Müşteri bulunamadı" };
    }

    if (isDbConnectionError(error)) {
      return {
        success: false,
        error: "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin.",
      };
    }

    return { success: false, error: "Damga silinemedi. Lütfen tekrar deneyin." };
  }
}
