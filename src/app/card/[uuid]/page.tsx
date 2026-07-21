// src/app/card/[uuid]/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCustomerByUuid } from "@/actions/customer";
import { CustomerCardView } from "@/components/stamp-card/CustomerCardView";
import { StaffActionPanel } from "@/components/staff/StaffActionPanel";
import { generateQrDataUrl } from "@/lib/qr";

interface Props {
  params: Promise<{ uuid: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { uuid } = await params;
  const customer = await getCustomerByUuid(uuid);
  if (!customer) return { title: "Müşteri Bulunamadı" };
  return { title: `${customer.name} — Sadakat Kartı` };
}

export default async function CardPage({ params }: Props) {
  const { uuid } = await params;
  const [customer, session, qrDataUrl] = await Promise.all([
    getCustomerByUuid(uuid),
    auth(),
    generateQrDataUrl(uuid),
  ]);

  if (!customer) notFound();

  const isStaff =
    session?.user?.role === "STAFF" || session?.user?.role === "ADMIN";

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-950 via-green-900 to-emerald-800">
      {/* Header */}
      <header className="px-4 py-4 flex items-center justify-between max-w-2xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🫓</span>
          <span className="text-white font-bold text-lg">Ekrem Coşkun Döner</span>
        </div>
        {isStaff && (
          <span className="text-xs bg-amber-500 text-amber-950 px-2 py-1 rounded-full font-semibold">
            Personel Görünümü
          </span>
        )}
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-8 space-y-4">
        {/* Always show the customer card */}
        <CustomerCardView customer={customer} qrDataUrl={qrDataUrl} />

        {/* Staff panel appears below when logged in */}
        {isStaff && (
          <StaffActionPanel
            customer={{
              id: customer.id,
              name: customer.name,
              phone: customer.phone,
              currentCycleCount: customer.currentCycleCount,
              lifetimeCount: customer.lifetimeCount,
            }}
            pendingRewards={customer.rewards
              .filter((r) => r.status === "PENDING")
              .map((r) => ({ id: r.id, rewardName: r.rule.rewardName, createdAt: r.createdAt }))}
          />
        )}
      </main>
    </div>
  );
}
