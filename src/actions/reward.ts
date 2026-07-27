// src/actions/reward.ts
"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidateStampSurfaces } from "@/lib/revalidate";
import { Prisma } from "@prisma/client";
import { isDbConnectionError } from "@/lib/db-errors";

export type ClaimRewardResult =
  | { success: true; rewardName: string }
  | { success: false; error: string };

/**
 * Mark a PENDING reward as CLAIMED (Staff/Admin only).
 * Includes robust validation and error handling.
 */
export async function claimReward(
  rewardId: string
): Promise<ClaimRewardResult> {
  // ─── 1. Authentication & Authorization ─────────────────────────────────────
  const session = await auth();
  if (!session?.user || !["STAFF", "ADMIN"].includes(session.user.role)) {
    return { success: false, error: "Yetkisiz erişim" };
  }

  // ─── 2. Input Validation ───────────────────────────────────────────────────
  if (!rewardId || typeof rewardId !== "string") {
    return { success: false, error: "Geçersiz ödül kimliği" };
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        // ─── 3. Fetch Reward with Relations ────────────────────────────────────
        const reward = await tx.reward.findUnique({
          where: { id: rewardId },
          include: { rule: true, customer: true },
        });

        // ─── 4. Validate Reward Exists ─────────────────────────────────────────
        if (!reward) {
          throw new Error("REWARD_NOT_FOUND");
        }

        // ─── 5. Validate Reward Status ─────────────────────────────────────────
        if (reward.status !== "PENDING") {
          throw new Error("REWARD_ALREADY_CLAIMED");
        }

        // ─── 6. Update Reward Status ───────────────────────────────────────────
        await tx.reward.update({
          where: { id: rewardId },
          data: {
            status: "CLAIMED",
            claimedAt: new Date(),
          },
        });

        return {
          rewardName: reward.rule.rewardName,
          customerName: reward.customer.name,
          qrUuid: reward.customer.qrUuid,
        };
      },
      {
        maxWait: 5000,
        timeout: 10000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      }
    );

    // ─── 7. Revalidate Paths ───────────────────────────────────────────────────
    // NOTE: revalidatePath("/card") never matched the dynamic /card/[uuid]
    // route — revalidateStampSurfaces() handles both forms.
    revalidateStampSurfaces(result.qrUuid);

    console.log(
      `[claimReward] Success: ${result.rewardName} claimed for ${result.customerName}`
    );

    return { success: true, rewardName: result.rewardName };
  } catch (error) {
    // ─── 8. Error Handling ─────────────────────────────────────────────────────
    console.error("[claimReward] Error:", error);

    if (error instanceof Error) {
      if (error.message === "REWARD_NOT_FOUND") {
        return { success: false, error: "Ödül bulunamadı" };
      }
      if (error.message === "REWARD_ALREADY_CLAIMED") {
        return {
          success: false,
          error: "Bu ödül zaten kullanılmış veya geçersiz",
        };
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
      error: "Ödül kullanılamadı. Lütfen tekrar deneyin.",
    };
  }
}

/**
 * Get all pending rewards for a customer
 */
export async function getPendingRewards(customerId: string) {
  const session = await auth();
  if (!session?.user || !["STAFF", "ADMIN"].includes(session.user.role)) {
    return null;
  }

  try {
    return await prisma.reward.findMany({
      where: {
        customerId,
        status: "PENDING",
      },
      include: {
        rule: true,
        order: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  } catch (error) {
    console.error("[getPendingRewards] Error:", error);
    return null;
  }
}
