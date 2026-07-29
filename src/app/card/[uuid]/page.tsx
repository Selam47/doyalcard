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
// Read access itself is gated too — see src/lib/card-access.ts. A card is
// KVKK personal data, so knowing the UUID is not enough: the viewer must be
// the customer who owns it, or active staff.
import type { Metadata } from "next";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { resolveCardAccess } from "@/lib/card-access";
import { CustomerCardView } from "@/components/stamp-card/CustomerCardView";
import { InstallPrompt } from "@/components/customer/InstallPrompt";
import { generateQrDataUrl } from "@/lib/qr";
import { getCampaignConfig } from "@/lib/campaign-rules.server";

// Stamp progress depends on live campaign rules and order counts, and the page
// output varies per viewer — never statically cache it.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ uuid: string }>;
}

// Deliberately static. The old implementation put the customer's real name in
// the <title>, which leaked it to anyone who requested the URL — including
// link-preview crawlers in group chats — before any authorization ran.
export const metadata: Metadata = {
  title: "Sadakat Kartı — Ekrem Coşkun Döner",
  robots: { index: false, follow: false },
};

export default async function CardPage({ params }: Props) {
  const { uuid } = await params;

  // ── Authorization ─────────────────────────────────────────────────────────
  const access = await resolveCardAccess(uuid);

  if (access.status === "unauthenticated") {
    // No session of any kind. Customers sign in with their phone number; the
    // customer login page carries a "Personel Girişi" link for staff.
    redirect("/customer/login");
  }

  if (access.status === "forbidden") {
    // Signed-in customer following somebody else's QR — bounce them to their
    // own card rather than confirming that the other card exists.
    redirect("/customer/dashboard");
  }

  if (access.status === "not-found") notFound();

  const { customer, staff } = access;

  const [qrDataUrl, campaign] = await Promise.all([
    generateQrDataUrl(uuid),
    // Single source of truth: the active CampaignRule row decides how many
    // stamp slots EVERY card shows — never the customer record, never a
    // hardcoded limit.
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
          Staff get a LINK to the till, never the controls themselves. The
          destination re-authorizes on its own, so this link grants nothing —
          it is a shortcut, not a permission.
        */}
        {staff && (
          <Link
            href={`/staff/customer/${uuid}`}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-amber-500/90 hover:bg-amber-400 text-amber-950 font-semibold text-sm transition-colors"
          >
            <span>⚡</span>
            Personel İşlem Paneline Git
          </Link>
        )}
      </main>
    </div>
  );
}
