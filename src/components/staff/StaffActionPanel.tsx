"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addOrder } from "@/actions/order";
import { claimReward } from "@/actions/reward";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/utils";

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
}

export function StaffActionPanel({ customer, pendingRewards }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
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
          toast.success(`🏆 Büyük Ödül Kazanıldı! "${result.reward.rewardName}" — Döngü sıfırlandı!`, {
            duration: 6000,
          });
        } else {
          toast.success(`🎁 Ödül Kazanıldı: "${result.reward.rewardName}"`, {
            duration: 5000,
          });
        }
      } else {
        toast.success(`✅ Sipariş eklendi. Toplam: ${result.lifetimeCount}`);
      }

      router.refresh();
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
        {/* Customer stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-green-50 rounded-xl p-4 text-center">
            <div className="text-3xl font-extrabold text-green-700">
              {customer.currentCycleCount}
              <span className="text-lg text-green-400">/11</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">Mevcut Döngü</div>
          </div>
          <div className="bg-blue-50 rounded-xl p-4 text-center">
            <div className="text-3xl font-extrabold text-blue-700">
              {customer.lifetimeCount}
            </div>
            <div className="text-xs text-gray-500 mt-1">Toplam Sipariş</div>
          </div>
        </div>

        {/* Add order button */}
        <button
          id="add-order-btn"
          onClick={handleAddOrder}
          disabled={isPending}
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
      </div>
    </div>
  );
}
