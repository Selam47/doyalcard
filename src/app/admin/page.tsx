import type { Metadata } from "next";

import { getDashboardStats } from "@/actions/admin";
import { getAnalyticsBranches } from "@/actions/analytics";
import { MonthlyAnalytics } from "@/components/admin/MonthlyAnalytics";
import { currentIstanbulMonth } from "@/lib/istanbul-time";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Admin Dashboard" };

export default async function AdminDashboard() {
  const [statsResult, branches] = await Promise.all([
    getDashboardStats(),
    getAnalyticsBranches(),
  ]);

  const today = currentIstanbulMonth();

  // `stats` is a discriminated result: on failure there are no numbers at all,
  // and the page renders an explicit error state rather than a grid of zeros.
  const data = statsResult.success ? statsResult.stats : null;
  const statsError = statsResult.success ? null : statsResult.error;

  const cards = data
    ? [
        {
          label: "Toplam Sipariş",
          value: data.totalOrders,
          emoji: "🫓",
          color: "bg-green-50 border-green-200 text-green-700",
          trend: data.recentOrders > 0 ? `+${data.recentOrders} son 7 gün` : null,
        },
        {
          label: "Kayıtlı Müşteri",
          value: data.totalCustomers,
          emoji: "👥",
          color: "bg-blue-50 border-blue-200 text-blue-700",
          trend: null,
        },
        {
          label: "Ödül Verildi",
          value: data.totalRewards,
          emoji: "🎁",
          color: "bg-amber-50 border-amber-200 text-amber-700",
          trend: `${data.pendingRewards} bekliyor`,
        },
        {
          label: "Ödül Kullanıldı",
          value: data.claimedRewards,
          emoji: "✅",
          color: "bg-purple-50 border-purple-200 text-purple-700",
          trend: null,
        },
        {
          label: "Aktif Şube",
          value: data.branches,
          emoji: "🏪",
          color: "bg-orange-50 border-orange-200 text-orange-700",
          trend: null,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">Sistem geneli istatistikler ve yönetim paneli</p>
      </div>

      {/* Stats Grid — or an explicit error state when the counters could not
          be read. Never render zeros for a failed fetch: "0 Toplam Sipariş"
          reads as real data. */}
      {statsError ? (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 bg-red-50 p-5 flex items-start gap-3"
        >
          <span className="text-2xl" aria-hidden="true">
            ⚠️
          </span>
          <div className="space-y-1">
            <p className="font-semibold text-red-800 text-sm">
              İstatistikler yüklenemedi
            </p>
            <p className="text-sm text-red-700">{statsError}</p>
            <p className="text-xs text-red-600/80">
              Sayfayı yenileyerek tekrar deneyebilirsiniz.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {cards.map((card) => (
            <div
              key={card.label}
              className={`rounded-2xl border p-5 flex flex-col items-center text-center gap-2 ${card.color} transition-transform hover:scale-105`}
            >
              <span className="text-3xl">{card.emoji}</span>
              <div className="text-3xl font-extrabold">{card.value}</div>
              <div className="text-xs font-medium opacity-80">{card.label}</div>
              {card.trend && (
                <div className="text-[10px] opacity-60 mt-1">{card.trend}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <h2 className="font-semibold text-gray-800 mb-4">Hızlı Erişim</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { 
              href: "/admin/rules", 
              title: "Kampanya Kuralları", 
              desc: "Ödül eşiklerini ve ödülleri yönet", 
              emoji: "🎯",
              color: "hover:bg-green-50 hover:border-green-200"
            },
            { 
              href: "/admin/branches", 
              title: "Şube Yönetimi", 
              desc: "Şube ekle, düzenle veya sil", 
              emoji: "🏪",
              color: "hover:bg-blue-50 hover:border-blue-200"
            },
            { 
              href: "/admin/staff", 
              title: "Personel Yönetimi", 
              desc: "Personel hesaplarını yönet", 
              emoji: "👥",
              color: "hover:bg-purple-50 hover:border-purple-200"
            },
            { 
              href: "/staff", 
              title: "Personel Paneli", 
              desc: "Staff görünümüne geç", 
              emoji: "🫓",
              color: "hover:bg-amber-50 hover:border-amber-200"
            },
            { 
              href: "/staff/register", 
              title: "Müşteri Kaydı", 
              desc: "Yeni müşteri ekle", 
              emoji: "➕",
              color: "hover:bg-green-50 hover:border-green-200"
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-xl border border-gray-100 p-4 transition-all flex items-start gap-3 ${item.color}`}
            >
              <span className="text-2xl">{item.emoji}</span>
              <div className="flex-1">
                <div className="font-semibold text-gray-800 text-sm">{item.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">{item.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Monthly Analytics */}
      <MonthlyAnalytics
        currentYear={today.year}
        currentMonth={today.month}
        branches={branches}
      />

      {/* System Info */}
      <div className="grid gap-4 md:grid-cols-2">
        {data ? (
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl border border-green-100 p-6">
            <h3 className="font-semibold text-green-800 mb-3">📊 Sistem Durumu</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-green-700">Toplam Sipariş:</span>
                <span className="font-bold text-green-900">{data.totalOrders}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-green-700">Bekleyen Ödül:</span>
                <span className="font-bold text-green-900">{data.pendingRewards}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-green-700">Son 7 Gün:</span>
                <span className="font-bold text-green-900">{data.recentOrders} sipariş</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 rounded-2xl border border-gray-200 p-6">
            <h3 className="font-semibold text-gray-700 mb-3">📊 Sistem Durumu</h3>
            <p className="text-sm text-gray-500">
              Sayaçlar okunamadığı için sistem durumu gösterilemiyor.
            </p>
          </div>
        )}

        <div
          className={`rounded-2xl border p-6 ${
            data
              ? "bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-100"
              : "bg-red-50 border-red-200"
          }`}
        >
          <h3
            className={`font-semibold mb-3 ${
              data ? "text-blue-800" : "text-red-800"
            }`}
          >
            ℹ️ Sistem Bilgisi
          </h3>
          {/*
            These lines used to be hardcoded "✅ Database bağlantısı başarılı",
            which was printed even while the counter queries were failing. They
            are now derived from the actual fetch result.
          */}
          <div
            className={`space-y-2 text-sm ${
              data ? "text-blue-700" : "text-red-700"
            }`}
          >
            {data ? (
              <>
                <p>✅ Tüm servisler aktif</p>
                <p>✅ Database bağlantısı başarılı</p>
                <p>✅ {data.branches} şube online</p>
              </>
            ) : (
              <>
                <p>⚠️ Database sorguları başarısız</p>
                <p>⚠️ Şube ve sipariş sayıları okunamıyor</p>
              </>
            )}
            <p
              className={`text-xs opacity-70 mt-3 ${
                data ? "" : "text-red-600"
              }`}
            >
              Ekrem Coşkun Döner Sadakat Sistemi v1.0
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
