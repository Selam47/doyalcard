// src/actions/order.ts
"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { isDbConnectionError } from "@/lib/db-errors";

export type AddOrderResult =
  | {
      success: true;
      newCycleCount: number;
      lifetimeCount: number;
      reward?: { rewardName: string; isResetPoint: boolean };
    }
  | { success: false; error: string };

/**
 * Core business logic: Add +1 order for a customer.
 *
 * Flow:
 * 1. Increment both lifetime_count and current_cycle_count.
 * 2. Check if the new current_cycle_count matches any active CampaignRule.
 * 3. If a rule matches, create a PENDING Reward linked to this Order.
 * 4. If the matched rule is_reset_point, reset current_cycle_count to 0.
 *
 * This is intentionally done inside a transaction to ensure atomicity.
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
    const result = await prisma.$transaction(
      async (tx) => {
        // ─── 3. Verify Customer Exists ─────────────────────────────────────────
        const customer = await tx.customer.findUnique({
          where: { id: customerId },
          select: { id: true, currentCycleCount: true, lifetimeCount: true },
        });

        if (!customer) {
          throw new Error("CUSTOMER_NOT_FOUND");
        }

        // ─── 4. Compute New Counts ─────────────────────────────────────────────
        const newCycleCount = customer.currentCycleCount + 1;
        const newLifetimeCount = customer.lifetimeCount + 1;

        // ─── 5. Fetch Active Campaign Rules ────────────────────────────────────
        const activeRules = await tx.campaignRule.findMany({
          where: { isActive: true },
          orderBy: { threshold: "asc" },
        });

        // ─── 6. Find Matching Rule ─────────────────────────────────────────────
        const matchedRule =
          activeRules.find((r) => r.threshold === newCycleCount) ?? null;

        // ─── 7. Determine Final Cycle Count (After Reset Logic) ────────────────
        const finalCycleCount = matchedRule?.isResetPoint ? 0 : newCycleCount;

        // ─── 8. Create Order Record ────────────────────────────────────────────
        const order = await tx.order.create({
          data: {
            customerId: customer.id,
            branchId: session.user.branchId ?? null,
            staffId: session.user.id,
          },
        });

        // ─── 9. Create Reward (If Rule Matched) ────────────────────────────────
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

        // ─── 10. Update Customer Counters ──────────────────────────────────────
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            currentCycleCount: finalCycleCount,
            lifetimeCount: newLifetimeCount,
          },
        });

        return {
          newCycleCount: finalCycleCount,
          lifetimeCount: newLifetimeCount,
          reward: matchedRule
            ? {
                rewardName: matchedRule.rewardName,
                isResetPoint: matchedRule.isResetPoint,
              }
            : undefined,
        };
      },
      {
        maxWait: 5000, // Maximum time to wait for a transaction slot (5s)
        timeout: 10000, // Maximum time for transaction to complete (10s)
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      }
    );

    // ─── 11. Revalidate Paths ──────────────────────────────────────────────────
    revalidatePath(`/card`);
    revalidatePath(`/staff`);
    revalidatePath(`/admin`);

    return { success: true, ...result };
  } catch (error) {
    // ─── 12. Error Handling ────────────────────────────────────────────────────
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

    return {
      success: false,
      error: "Sipariş eklenemedi. Lütfen tekrar deneyin.",
    };
  }
}
