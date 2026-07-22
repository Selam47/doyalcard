"use client";

// src/components/customer/CustomerDashboard.tsx
// Full customer loyalty dashboard — QR code, stamp progress, history, sign out.

import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Order {
  id: string;
  createdAt: string;
  rewardName: string | null;
  rewardStatus: string | null;
}

interface Reward {
  id: string;
  rewardName: string;
  status: string;
  createdAt: string;
  claimedAt: string | null;
}

interface CustomerData {
  id: string;
  name: string;
  phone: string;
  qrUuid: string;
  currentCycleCount: number;
  lifetimeCount: number;
  createdAt: string;
  nextThreshold: number;
  nextRewardName: string;
  orders: Order[];
  rewards: Reward[];
}

interface Props {
  initialData: CustomerData;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function maskPhone(phone: string): string {
  // e.g. +905321234567 → +90 5XX XXX XX 67
  if (phone.length < 6) return phone;
  const start = phone.slice(0, phone.length - 7);
  const masked = "X".repeat(5);
  const end = phone.slice(-2);
  return `${start} ${masked}${end}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function RewardStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string }> = {
    PENDING: { label: "Bekliyor", classes: "bg-yellow-400/20 text-yellow-300 border-yellow-400/30" },
    CLAIMED: { label: "Kullanıldı", classes: "bg-green-400/20 text-green-300 border-green-400/30" },
    EXPIRED: { label: "Süresi Doldu", classes: "bg-red-400/20 text-red-300 border-red-400/30" },
  };
  const s = map[status] ?? map["PENDING"];
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${s.classes}`}>
      {s.label}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function CustomerDashboard({ initialData }: Props) {
  const router = useRouter();
  const [data] = useState<CustomerData>(initialData);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [activeTab, setActiveTab] = useState<"history" | "rewards">("history");

  // Generate QR code client-side using qrcode library
  useEffect(() => {
    let cancelled = false;
    async function loadQr() {
      try {
        const { generateQrDataUrl } = await import("@/lib/qr");
        const url = await generateQrDataUrl(data.qrUuid);
        if (!cancelled) setQrDataUrl(url);
      } catch (e) {
        console.error("QR generation failed", e);
      }
    }
    loadQr();
    return () => { cancelled = true; };
  }, [data.qrUuid]);

  const progress = Math.min(
    (data.currentCycleCount / data.nextThreshold) * 100,
    100
  );

  // Stamp bubbles — visual grid
  const stamps = Array.from({ length: data.nextThreshold }, (_, i) => i < data.currentCycleCount);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/customer/logout", { method: "POST" });
      router.push("/customer/login");
      router.refresh();
    } catch {
      toast.error("Çıkış yapılamadı.");
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-950 via-green-900 to-emerald-800">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-green-950/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl" role="img" aria-label="döner">🫓</span>
            <div>
              <p className="text-white font-semibold text-sm leading-none">
                {data.name === "Müşteri" ? "Sadakat Kartım" : data.name}
              </p>
              <p className="text-green-400 text-xs mt-0.5">{maskPhone(data.phone)}</p>
            </div>
          </div>
          <button
            id="sign-out-btn"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm transition-all disabled:opacity-60"
          >
            {signingOut ? (
              <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            )}
            Çıkış
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-5 pb-12">

        {/* ── QR Card ───────────────────────────────────────────────────────── */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 shadow-2xl text-center">
          <p className="text-green-300 text-xs font-medium uppercase tracking-widest mb-4">
            Kişisel QR Kodunuz
          </p>

          <div className="inline-block p-3 bg-white rounded-2xl shadow-xl mb-4">
            {qrDataUrl ? (
              <Image
                src={qrDataUrl}
                alt="Müşteri QR kodu"
                width={180}
                height={180}
                className="rounded-xl"
                unoptimized
              />
            ) : (
              <div className="w-[180px] h-[180px] flex items-center justify-center">
                <span className="animate-spin inline-block w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full" />
              </div>
            )}
          </div>

          <p className="text-white/60 text-xs">
            Kasada bu kodu gösterin, puan kazanın.
          </p>
        </div>

        {/* ── Progress Card ─────────────────────────────────────────────────── */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-6 shadow-xl">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-green-300 text-xs font-medium uppercase tracking-widest">
                Mevcut Döngü
              </p>
              <p className="text-white text-3xl font-bold mt-1">
                {data.currentCycleCount}
                <span className="text-white/40 text-xl font-normal"> / {data.nextThreshold}</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-green-300 text-xs font-medium uppercase tracking-widest">
                Ödülünüz
              </p>
              <p className="text-white font-semibold mt-1 text-sm">
                {data.nextRewardName}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="relative h-3 bg-white/10 rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-green-400 to-emerald-300 rounded-full transition-all duration-700 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-white/50 text-xs mt-2 text-right">
            {data.nextThreshold - data.currentCycleCount > 0
              ? `${data.nextThreshold - data.currentCycleCount} sipariş daha — ödül kazanırsınız!`
              : "Ödülünüzü kullanmaya hazırsınız! 🎉"}
          </p>

          {/* Stamp grid */}
          <div className="mt-5 flex flex-wrap gap-2">
            {stamps.map((filled, i) => (
              <div
                key={i}
                className={`w-9 h-9 rounded-full flex items-center justify-center text-base border-2 transition-all duration-300 ${
                  filled
                    ? "bg-green-400 border-green-300 shadow-lg shadow-green-400/30"
                    : "bg-white/5 border-white/20"
                }`}
                aria-label={filled ? `Puan ${i + 1} dolu` : `Puan ${i + 1} boş`}
              >
                {filled ? "🫓" : ""}
              </div>
            ))}
          </div>
        </div>

        {/* ── Stats Row ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-4 text-center">
            <p className="text-3xl font-bold text-white">{data.lifetimeCount}</p>
            <p className="text-green-300 text-xs mt-1 uppercase tracking-wider">Toplam Sipariş</p>
          </div>
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-4 text-center">
            <p className="text-3xl font-bold text-white">{data.rewards.length}</p>
            <p className="text-green-300 text-xs mt-1 uppercase tracking-wider">Kazanılan Ödül</p>
          </div>
        </div>

        {/* ── Activity Tabs ─────────────────────────────────────────────────── */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl overflow-hidden shadow-xl">
          {/* Tab bar */}
          <div className="flex border-b border-white/10">
            {(["history", "rewards"] as const).map((tab) => (
              <button
                key={tab}
                id={`tab-${tab}`}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? "text-white border-b-2 border-green-400"
                    : "text-white/50 hover:text-white/80"
                }`}
              >
                {tab === "history" ? "Sipariş Geçmişi" : "Ödüllerim"}
              </button>
            ))}
          </div>

          {/* History tab */}
          {activeTab === "history" && (
            <div className="divide-y divide-white/10">
              {data.orders.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-4xl mb-2">🫓</p>
                  <p className="text-white/50 text-sm">Henüz sipariş yok.</p>
                </div>
              ) : (
                data.orders.map((order, i) => (
                  <div key={order.id} className="flex items-center gap-3 px-5 py-3.5">
                    {/* Timeline dot */}
                    <div className="relative flex-shrink-0">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                        order.rewardName ? "bg-green-400/20 border border-green-400/40" : "bg-white/10 border border-white/20"
                      }`}>
                        {order.rewardName ? "🎁" : "🫓"}
                      </div>
                      {i < data.orders.length - 1 && (
                        <div className="absolute left-1/2 top-full -translate-x-1/2 w-px h-3 bg-white/10" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">
                        {order.rewardName ? `Ödül: ${order.rewardName}` : "Etli Ekmek Siparişi"}
                      </p>
                      <p className="text-white/40 text-xs">{formatDate(order.createdAt)}</p>
                    </div>
                    {order.rewardStatus && (
                      <RewardStatusBadge status={order.rewardStatus} />
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Rewards tab */}
          {activeTab === "rewards" && (
            <div className="divide-y divide-white/10">
              {data.rewards.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-4xl mb-2">🎁</p>
                  <p className="text-white/50 text-sm">Henüz ödül kazanılmadı.</p>
                  <p className="text-white/30 text-xs mt-1">
                    {data.nextThreshold - data.currentCycleCount} sipariş sonra ilk ödülünüzü kazanırsınız!
                  </p>
                </div>
              ) : (
                data.rewards.map((reward) => (
                  <div key={reward.id} className="flex items-center gap-3 px-5 py-3.5">
                    <div className="w-8 h-8 rounded-full bg-yellow-400/20 border border-yellow-400/40 flex items-center justify-center text-sm flex-shrink-0">
                      🏆
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{reward.rewardName}</p>
                      <p className="text-white/40 text-xs">
                        {formatDate(reward.createdAt)}
                        {reward.claimedAt && ` · Kullanıldı: ${formatDate(reward.claimedAt)}`}
                      </p>
                    </div>
                    <RewardStatusBadge status={reward.status} />
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Member since */}
        <p className="text-center text-white/30 text-xs">
          Üye olma tarihi: {formatDate(data.createdAt)}
        </p>
      </main>
    </div>
  );
}
