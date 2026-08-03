"use server";

import { prisma } from "@/lib/prisma";
import { authorizeStaff } from "@/lib/staff-guard";
import { revalidateStampSurfaces } from "@/lib/revalidate";
import { Prisma } from "@/generated/prisma/client";
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
  const guard = await authorizeStaff();
  if (!guard.ok) return { success: false, error: guard.error };

  if (!rewardId || typeof rewardId !== "string") {
    return { success: false, error: "Geçersiz ödül kimliği" };
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const reward = await tx.reward.findUnique({
          where: { id: rewardId },
          include: { rule: true, customer: true },
        });

        if (!reward) {
          throw new Error("REWARD_NOT_FOUND");
        }

        const claimed = await tx.reward.updateMany({
          where: { id: rewardId, status: "PENDING" },
          data: {
            status: "CLAIMED",
            claimedAt: new Date(),
          },
        });

        if (claimed.count === 0) {
          throw new Error("REWARD_ALREADY_CLAIMED");
        }

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

    revalidateStampSurfaces(result.qrUuid);

    console.log(
      `[claimReward] Success: ${result.rewardName} claimed for ${result.customerName}`
    );

    return { success: true, rewardName: result.rewardName };
  } catch (error) {
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
