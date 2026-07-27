// src/app/customer/dashboard/page.tsx
// Protected server component — reads session, fetches customer data, and renders
// the EXACT SAME CustomerCardView that staff/admin see at /card/[uuid].
// Admin-only actions (StaffActionPanel) are simply not rendered here.

import type { Metadata } from "next";

import { redirect } from "next/navigation";
import { getCustomerSession } from "@/lib/customer-session";
import { getCustomerById } from "@/actions/customer";
import { generateQrDataUrl } from "@/lib/qr";
import { CustomerCardView } from "@/components/stamp-card/CustomerCardView";
import { CustomerPageShell } from "@/components/customer/CustomerPageShell";
import { getCampaignConfig } from "@/lib/campaign-rules.server";

// Customer stamp progress depends on live campaign rules and order counts —
// never statically cache this page.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sadakat Kartım",
  description: "Puan durumunuz, QR kodunuz ve sipariş geçmişiniz.",
};

export default async function CustomerDashboardPage() {
  // ── Auth guard ────────────────────────────────────────────────────────────
  const session = await getCustomerSession();
  if (!session) redirect("/customer/login");

  // ── Fetch the logged-in customer's data (same query shape as /card/[uuid]) ─
  const customer = await getCustomerById(session.customerId);

  if (!customer) {
    // Session points to a deleted customer — clear and bounce
    redirect("/customer/login");
  }

  // Generate the QR data URL now that we have the qrUuid
  // Same single source of truth as /card/[uuid] — identical slot count.
  const [qrCode, campaign] = await Promise.all([
    generateQrDataUrl(customer.qrUuid),
    getCampaignConfig(),
  ]);

  // ── Render: CustomerPageShell (header+logout) + CustomerCardView (shared UI) ─
  return (
    <CustomerPageShell
      customerName={customer.name}
      customerPhone={customer.phone}
    >
      {/* Exact same component staff/admin see at /card/[uuid] */}
      <CustomerCardView
        customer={customer}
        qrDataUrl={qrCode}
        activeRules={campaign.rules}
        maxStamps={campaign.maxStamps}
      />
    </CustomerPageShell>
  );
}

