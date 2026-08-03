// src/app/card/[uuid]/page.tsx
//
// PUBLIC-FACING CARD — STRICTLY READ-ONLY.
//
// This route renders a stamp card and nothing else. It has NO import of
// StaffActionPanel, DeleteCustomerButton or any mutation, so no combination of
// session, role, cookie or crafted URL can make an action button appear here.
// That is the point: "+1 Sipariş", "-1 Damga" and "Müşteriyi Sil" live on
// /staff/customer/[uuid], behind the middleware-protected /staff prefix.
//
// It also renders NO navigation toward the staff terminal — not even for an
// authenticated ADMIN. A raw QR scan from a native camera app lands here and
// must be a dead end for everyone, so there is deliberately no link, no
// redirect and no role-conditional branch pointing at /staff/*. Staff reach
// the till by signing into the staff portal and using the in-app scanner
// (/staff), which rewrites the decoded URL to /staff/customer/<uuid> itself.
//
// Read access itself is gated too — see src/lib/card-access.ts. A card is
// KVKK personal data, so knowing the UUID is not enough: the viewer must be
// the customer who owns it, or active staff.
import type { Metadata } from "next";

import { notFound, redirect } from "next/navigation";
import { resolveCardAccess } from "@/lib/card-access";
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

  const access = await resolveCardAccess(uuid);

  if (access.status === "unauthenticated") {
    const loginUrl = new URLSearchParams({ callbackUrl: `/card/${uuid}` });
    redirect(`/customer/login?${loginUrl.toString()}`);
  }

  if (access.status === "forbidden") {
    redirect("/customer/dashboard");
  }

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

        {/*
          NOTHING follows the card. Do not add a staff shortcut here — not
          behind a role check, not behind a feature flag. This page is the
          landing spot for a raw camera scan, and it stays a read-only dead end
          for every viewer.
        */}
      </main>
    </div>
  );
}
