// src/app/card/[uuid]/page.tsx
//
// PUBLIC-FACING CARD — NO LOGIN, STRICTLY READ-ONLY.
//
// This route is PUBLIC on purpose and must stay that way. A customer points a
// raw phone camera at the QR code on their own card; the camera opens a fresh,
// cookie-less tab straight at this URL. If this page requires a session, that
// scan lands on a login screen and the core flow of the product is broken.
// So: NO auth() call, NO getStaffPrincipal(), NO customer-session read, and no
// redirect to /login or /customer/login anywhere below. The only exit other
// than rendering is notFound(), for a UUID that matches no customer.
//
// It is also OUTSIDE the app's session machinery by design. Middleware lets
// /card through before it consults a session (CUSTOMER_PAGE_PREFIXES), and
// TabSessionGuard deliberately does not list /card among its protected
// prefixes — a raw scan is always a "fresh tab", so guarding it there would
// bounce every single scan to login. Auth fixes for the staff/admin layouts,
// customer OTP login or tab-session invalidation must not be extended here.
//
// STRICTLY READ-ONLY: there is NO import of StaffActionPanel,
// DeleteCustomerButton or any Server Action, so no combination of session,
// role, cookie or crafted URL can make a mutating control appear. "+1 Sipariş",
// "-1 Damga" and "Müşteriyi Sil" live only on /staff/customer/[uuid], behind
// the middleware-protected /staff prefix.
//
// It renders NO navigation toward the staff terminal either — not even for an
// authenticated ADMIN. Nothing here varies by viewer; the page never learns who
// is looking. Staff reach the till by signing into the staff portal and using
// the in-app scanner (/staff), which rewrites the decoded URL to
// /staff/customer/<uuid> itself.
//
// The UUID is the credential: v4, unguessable, never listed or searchable, and
// the projection in card-access.ts is the privacy boundary — do not widen it.
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
