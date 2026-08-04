import type { Metadata } from "next";

import { notFound } from "next/navigation";
import { resolvePublicCardAccess } from "@/lib/card-access";
import { CustomerCardView } from "@/components/stamp-card/CustomerCardView";
import { InstallPrompt } from "@/components/customer/InstallPrompt";
import { generateQrDataUrl } from "@/lib/qr";
import { getCampaignConfig } from "@/lib/campaign-rules.server";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string }>;
}

export const metadata: Metadata = {
  title: "Sadakat Kartı — Ekrem Coşkun Döner",
  robots: { index: false, follow: false },
};

export default async function CardPage({ params }: Props) {
  const { uuid } = await params;

  // No session is read here, by design. The only failure mode is "this UUID
  // is not a card" — never "you are not allowed to see this card".
  const access = await resolvePublicCardAccess(uuid);

  if (access.status === "not-found") notFound();

  const { customer } = access;

  const [qrDataUrl, campaign] = await Promise.all([
    generateQrDataUrl(uuid),
    getCampaignConfig(),
  ]);

  const { rules: activeRules, maxStamps } = campaign;

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-950 via-green-900 to-emerald-800">
      {/* Header */}
      <header className="px-4 py-4 flex items-center justify-between max-w-2xl mx-auto">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🫓</span>
          <span className="text-white font-bold text-lg">Ekrem Coşkun Döner</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pb-8 space-y-4">
        {/* Non-intrusive "Ana Ekrana Ekle" (Add to Home Screen) banner */}
        <InstallPrompt />

        {/* The ONLY thing this route renders: the read-only card. */}
        <CustomerCardView
          customer={customer}
          qrDataUrl={qrDataUrl}
          activeRules={activeRules}
          maxStamps={maxStamps}
        />

        {
       }
      </main>
    </div>
  );
}
