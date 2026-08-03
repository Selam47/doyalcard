"use server";

import { prisma } from "@/lib/prisma";
import { authorizeStaff } from "@/lib/staff-guard";
import { Prisma } from "@/generated/prisma/client";
import { isDbConnectionError } from "@/lib/db-errors";
import { revalidateStampSurfaces } from "@/lib/revalidate";
import {
  clampCycleCount,
  pickCycleRule,
  resolveMaxStamps,
  type ActiveCampaignRule,
} from "@/lib/campaign-rules";

const TX_OPTIONS = {
  maxWait: 5000,
  timeout: 10000,
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
} as const;

/** Postgres serialization conflict under the Serializable isolation level. */
function isTxConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

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
  const guard = await authorizeStaff();
  if (!guard.ok) return { success: false, error: guard.error };
  const { staff } = guard;

  if (!customerId || typeof customerId !== "string") {
    return { success: false, error: "Geçersiz müşteri kimliği" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
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

      const activeRules: ActiveCampaignRule[] = await tx.campaignRule.findMany({
        where: { isActive: true },
        orderBy: { threshold: "asc" },
        select: RULE_SELECT,
      });

      const cycleRule = pickCycleRule(activeRules);
      const maxStamps = resolveMaxStamps(cycleRule);

      const baseCycleCount = Math.min(
        Math.max(0, customer.currentCycleCount),
        maxStamps
      );
      const nextCycleCount = baseCycleCount + 1;
      const nextLifetimeCount = Math.max(0, customer.lifetimeCount) + 1;

      const cycleCompleted = cycleRule !== null && nextCycleCount >= maxStamps;

      const matchedRule = cycleCompleted
        ? cycleRule
        : activeRules.find((r) => r.threshold === nextCycleCount) ?? null;

      const finalCycleCount = cycleCompleted ? 0 : nextCycleCount;

      const order = await tx.order.create({
        data: {
          customerId: customer.id,
          branchId: staff.branchId,
          staffId: staff.id,
        },
      });

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
              isResetPoint: cycleCompleted,
            }
          : undefined,
      };
    }, TX_OPTIONS);

    revalidateStampSurfaces(result.qrUuid);

    const { qrUuid: _qrUuid, ...payload } = result;
    void _qrUuid;
    return { success: true, ...payload };
  } catch (error) {
    console.error("[addOrder] Error:", error);

    if (error instanceof Error) {
      if (error.message === "CUSTOMER_NOT_FOUND") {
        return { success: false, error: "Müşteri bulunamadı" };
      }
      if (error.message.includes("Unique constraint")) {
        return { success: false, error: "Bu sipariş zaten kaydedildi" };
      }
    }

    if (isTxConflict(error)) {
      return {
        success: false,
        error: "Eşzamanlı işlem çakışması oluştu. Lütfen tekrar deneyin.",
      };
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
 * The order that is deleted is THE NEWEST one — the row `addOrder` just
 * created. It is never "the newest order that happens to have no reward":
 * searching for a reward-free row silently walked PAST the newest order
 * whenever that order granted a reward and deleted an unrelated older one, so
 * the correction landed on the wrong history entry, and when EVERY order
 * carried a reward the query found nothing at all, deleted nothing, and still
 * decremented both counters — which is exactly how `orders.count()` drifted
 * away from `lifetimeCount`.
 *
 * If the newest order has a Reward attached, the operation is REFUSED instead:
 * deleting that row would cascade the reward away (the relation is
 * `onDelete: Cascade`), silently voiding something the customer earned or has
 * already been handed. Refusing keeps the invariant
 * `orders.count() == lifetimeCount` true in both branches — counters only move
 * when a row actually moves with them.
 *
 * A stranded legacy cycle count is normalized against the active threshold
 * on the way down, so a correction can never leave the card above maxStamps.
 */
export async function removeStamp(
  customerId: string
): Promise<RemoveStampResult> {
  const guard = await authorizeStaff();
  if (!guard.ok) return { success: false, error: guard.error };

  if (!customerId || typeof customerId !== "string") {
    return { success: false, error: "Geçersiz müşteri kimliği" };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
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

      const activeRules: ActiveCampaignRule[] = await tx.campaignRule.findMany({
        where: { isActive: true },
        orderBy: { threshold: "asc" },
        select: RULE_SELECT,
      });
      const maxStamps = resolveMaxStamps(pickCycleRule(activeRules));

      // The row this correction is meant to undo: the customer's most recent
      // order, whatever it is. Ties on `createdAt` (two stamps inside the same
      // millisecond) are broken by `id` so the choice is deterministic.
      const lastOrder = await tx.order.findFirst({
        where: { customerId: customer.id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, reward: { select: { id: true } } },
      });

      if (!lastOrder) throw new Error("NO_ORDER_TO_REMOVE");
      if (lastOrder.reward) throw new Error("ORDER_HAS_REWARD");

      const baseCycleCount = clampCycleCount(customer.currentCycleCount, maxStamps);
      const newCycleCount = Math.max(0, baseCycleCount - 1);
      const newLifetimeCount = Math.max(0, customer.lifetimeCount - 1);

      await tx.order.delete({ where: { id: lastOrder.id } });

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

    revalidateStampSurfaces(result.qrUuid);

    const { qrUuid: _qrUuid, ...payload } = result;
    void _qrUuid;
    return { success: true, ...payload };
  } catch (error) {
    console.error("[removeStamp] Error:", error);

    if (error instanceof Error) {
      if (error.message === "CUSTOMER_NOT_FOUND") {
        return { success: false, error: "Müşteri bulunamadı" };
      }
      if (error.message === "NO_ORDER_TO_REMOVE") {
        return {
          success: false,
          error: "Bu müşteride silinecek sipariş yok.",
        };
      }
      if (error.message === "ORDER_HAS_REWARD") {
        return {
          success: false,
          error:
            "Son siparişe bir ödül bağlı olduğu için damga silinemez. Ödül geçmişini değiştirmek için yöneticinize başvurun.",
        };
      }
    }

    if (isTxConflict(error)) {
      return {
        success: false,
        error: "Eşzamanlı işlem çakışması oluştu. Lütfen tekrar deneyin.",
      };
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
