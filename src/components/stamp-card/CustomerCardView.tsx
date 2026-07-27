// src/components/stamp-card/CustomerCardView.tsx
import { maskPhone, formatDate } from "@/lib/utils";
import { StampGrid } from "./StampGrid";
import { RewardBadge } from "./RewardBadge";
import { clampCycleCount, type ActiveCampaignRule } from "@/lib/campaign-rules";

interface Reward {
  id: string;
  status: string;
  createdAt: Date;
  claimedAt: Date | null;
  rule: { rewardName: string; threshold: number };
}

interface Props {
  customer: {
    name: string;
    phone: string;
    currentCycleCount: number;
    lifetimeCount: number;
    createdAt: Date;
    branch?: { name: string } | null;
    rewards: Reward[];
  };
  qrDataUrl: string;
  activeRules: ActiveCampaignRule[];
  /**
   * Authoritative stamp-slot count, resolved server-side from the single
   * active CampaignRule. Passed in (never derived here) so the card, the
   * staff panel and the dashboard can never disagree.
   */
  maxStamps: number;
}

export function CustomerCardView({
  customer,
  qrDataUrl,
  activeRules,
  maxStamps,
}: Props) {
  const pendingRewards = customer.rewards.filter((r) => r.status === "PENDING");
  const claimedRewards = customer.rewards.filter((r) => r.status === "CLAIMED");
  // Legacy rows can sit above a since-lowered threshold — clamp for display.
  const cycleCount = clampCycleCount(customer.currentCycleCount, maxStamps);

  return (
    <div className="space-y-4">
      {/* Main loyalty card */}
      <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
        {/* Card header */}
        <div className="bg-gradient-to-r from-green-700 to-emerald-600 px-6 py-5 flex items-center justify-between">
          <div>
            <p className="text-green-200 text-xs font-medium uppercase tracking-widest mb-1">
              Sadakat Kartı
            </p>
            <h2 className="text-white text-2xl font-bold">{customer.name}</h2>
            <p className="text-green-200 text-sm mt-1">{maskPhone(customer.phone)}</p>
          </div>
          <div className="text-right">
            <div className="text-white/70 text-xs">Toplam Sipariş</div>
            <div className="text-white text-3xl font-extrabold">
              {customer.lifetimeCount}
            </div>
          </div>
        </div>

        {/* Stamp grid */}
        <div className="px-6 py-6">
          <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-4 flex items-center gap-2">
            <span>Mevcut Döngü</span>
            <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
              {cycleCount}/{maxStamps}
            </span>
          </p>
          <StampGrid
            currentCount={cycleCount}
            activeRules={activeRules}
            maxStamps={maxStamps}
          />
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-6 py-3 flex items-center justify-between text-xs text-gray-400">
          <span>Kayıt: {formatDate(customer.createdAt)}</span>
          {customer.branch && <span>📍 {customer.branch.name}</span>}
        </div>
      </div>

      {/* QR Code card */}
      <div className="bg-white rounded-2xl shadow-lg p-6 flex flex-col items-center gap-3">
        <p className="text-sm font-semibold text-gray-700">QR Kodunuz</p>
        <div className="p-3 bg-gray-50 rounded-xl border border-gray-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrDataUrl}
            alt="Müşteri QR Kodu"
            width={200}
            height={200}
            className="w-48 h-48"
          />
        </div>
        <p className="text-xs text-gray-400 text-center">
          Bu kodu kasaya okutun ve puan kazanın
        </p>
      </div>

      {/* Rewards section */}
      {(pendingRewards.length > 0 || claimedRewards.length > 0) && (
        <div className="bg-white rounded-2xl shadow-lg p-6 space-y-3">
          <h3 className="font-semibold text-gray-800">Ödülleriniz</h3>

          {pendingRewards.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Kullanılabilir
              </p>
              {pendingRewards.map((r) => (
                <RewardBadge key={r.id} reward={r} />
              ))}
            </div>
          )}

          {claimedRewards.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                Kullanıldı
              </p>
              {claimedRewards.slice(0, 3).map((r) => (
                <RewardBadge key={r.id} reward={r} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
