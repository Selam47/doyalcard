// src/actions/reward.ts
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
  // ─── 1. Authentication & Authorization ─────────────────────────────────────
  const guard = await authorizeStaff();
  if (!guard.ok) return { success: false, error: guard.error };

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

        // ─── 5. Atomically Claim (status guard inside the WHERE) ───────────────
        // A read-then-update lets two cashiers claim the same reward
        // concurrently under ReadCommitted; the guarded updateMany makes the
        // PENDING → CLAIMED transition atomic, so exactly one caller wins.
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
