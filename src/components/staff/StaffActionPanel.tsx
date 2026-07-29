"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addOrder, removeStamp } from "@/actions/order";
import { claimReward } from "@/actions/reward";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";
import { clampCycleCount } from "@/lib/campaign-rules";
import { DeleteCustomerButton } from "@/components/staff/DeleteCustomerButton";

interface PendingReward {
  id: string;
  rewardName: string;
  createdAt: Date;
}

interface Props {
  customer: {
    id: string;
    name: string;
    phone: string;
    currentCycleCount: number;
    lifetimeCount: number;
  };
  pendingRewards: PendingReward[];
  /**
   * Authoritative stamp-slot count from the single active CampaignRule,
   * resolved server-side. The panel NEVER derives its own limit, so the
   * "0/maxStamps" counter here always matches the customer's card.
   */
  maxStamps: number;
  /**
   * Resolved server-side from the session. Controls visibility of the
   * destructive "Müşteriyi Sil" action only — the real permission check lives
   * inside the deleteCustomer Server Action.
   */
  isAdmin: boolean;
}

export function StaffActionPanel({
  customer,
  pendingRewards,
  maxStamps,
  isAdmin,
}: Props) {
  const router = useRouter();
  // Legacy rows may exceed a since-lowered threshold — clamp for display.
  const cycleCount = clampCycleCount(customer.currentCycleCount, maxStamps);
  const [isPending, startTransition] = useTransition();
  const [isRemoving, startRemoveTransition] = useTransition();
  const [isClaimingId, setIsClaimingId] = useState<string | null>(null);

  function handleAddOrder() {
    startTransition(async () => {
      const result = await addOrder(customer.id);
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      if (result.reward) {
        if (result.reward.isResetPoint) {
          toast.success(
            `🎉 Tebrikler! "${result.reward.rewardName}" Kazandınız! — Döngü sıfırlandı!`,
            { duration: 6000 }
          );
        } else {
          toast.success(`🎁 Ödül Kazanıldı: "${result.reward.rewardName}"`, {
            duration: 5000,
          });
        }
      } else {
        toast.success(
          `✅ Sipariş eklendi. Döngü: ${result.newCycleCount}/${result.maxStamps} · Toplam: ${result.lifetimeCount}`
        );
      }

      router.refresh();
    });
  }

  function handleRemoveStamp() {
    startRemoveTransition(async () => {
      try {
        const result = await removeStamp(customer.id);
        if (!result.success) {
          toast.error(result.error);
          return;
        }
        toast.success(
          `➖ Damga silindi. Döngü: ${result.newCycleCount}/${result.maxStamps} · Toplam: ${result.lifetimeCount}`
        );
        router.refresh();
      } catch {
        toast.error("Damga silinemedi. Lütfen tekrar deneyin.");
      }
    });
  }

  async function handleClaimReward(rewardId: string, rewardName: string) {
    setIsClaimingId(rewardId);
    const result = await claimReward(rewardId);
    setIsClaimingId(null);

    if (!result.success) {
      toast.error(result.error);
    } else {
      toast.success(`✅ "${rewardName}" ödülü kullandırıldı`);
      router.refresh();
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-2xl border-2 border-amber-400 overflow-hidden">
      {/* Panel header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4">
        <h2 className="text-white font-bold text-lg flex items-center gap-2">
          <span>⚡</span> Personel İşlem Paneli
        </h2>
        <p className="text-amber-100 text-sm mt-0.5">{customer.name}</p>
      </div>

      <div className="p-6 space-y-5">
        {/*
          Compact status line only. The full "Mevcut Döngü / Toplam Sipariş"
          summary is rendered by CustomerCardView directly above this panel —
          repeating the big stat tiles here would just push the buttons off a
          phone screen. cycleCount is still needed for the -1 disable rule.
        */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            Mevcut Döngü{" "}
            <span className="font-bold text-green-700">
              {cycleCount}/{maxStamps}
            </span>
          </span>
          <span className="text-gray-500">
            Toplam{" "}
            <span className="font-bold text-blue-700">
              {customer.lifetimeCount}
            </span>
          </span>
        </div>

        {/* Add order button */}
        <button
          id="add-order-btn"
          onClick={handleAddOrder}
          disabled={isPending || isRemoving}
          className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 text-white font-bold text-lg shadow-lg shadow-green-900/30 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-3 active:scale-95"
        >
          {isPending ? (
            <>
              <span className="animate-spin inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full" />
              İşleniyor...
            </>
          ) : (
            <>
              <span className="text-2xl">🫓</span>
              +1 Etli Ekmek Siparişi
            </>
          )}
        </button>

        {/* Manual correction: -1 stamp */}
        <button
          id="remove-stamp-btn"
          onClick={handleRemoveStamp}
          disabled={
            isPending ||
            isRemoving ||
            (cycleCount === 0 && customer.lifetimeCount === 0)
          }
          className="w-full py-2.5 px-6 rounded-xl bg-white border-2 border-red-200 hover:bg-red-50 text-red-600 font-semibold text-sm shadow-sm transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-95"
        >
          {isRemoving ? (
            <>
              <span className="animate-spin inline-block w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full" />
              İşleniyor...
            </>
          ) : (
            <>
              <span>➖</span>
              -1 Damga Düzeltme
            </>
          )}
        </button>

        {/* Pending rewards */}
        {pendingRewards.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <span className="text-amber-500">🎁</span>
              Kullandırılacak Ödüller ({pendingRewards.length})
            </p>
            {pendingRewards.map((reward) => (
              <div
                key={reward.id}
                className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl"
              >
                <div className="flex-1">
                  <p className="font-semibold text-sm text-amber-800">
                    {reward.rewardName}
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatDate(reward.createdAt)}
                  </p>
                </div>
                <button
                  id={`claim-reward-${reward.id}`}
                  onClick={() => handleClaimReward(reward.id, reward.rewardName)}
                  disabled={isClaimingId === reward.id}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60 flex items-center gap-1.5"
                >
                  {isClaimingId === reward.id ? (
                    <span className="animate-spin w-3 h-3 border border-white border-t-transparent rounded-full" />
                  ) : (
                    "Kullandır"
                  )}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Danger zone — ADMIN only */}
        {isAdmin && (
          <div className="pt-4 border-t border-gray-100 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-500">
              Tehlikeli Bölge
            </p>
            <DeleteCustomerButton
              customerId={customer.id}
              customerName={customer.name}
              disabled={isPending || isRemoving || isClaimingId !== null}
            />
            <p className="text-[11px] text-gray-400 leading-snug">
              Müşteri, siparişleri ve ödülleri kalıcı olarak silinir. Bu işlem
              geri alınamaz.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
