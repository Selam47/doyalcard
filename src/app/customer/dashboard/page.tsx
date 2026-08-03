import type { Metadata } from "next";

import { redirect } from "next/navigation";
import { getCustomerSession } from "@/lib/customer-session";
import { getCustomerById } from "@/actions/customer";
import { generateQrDataUrl } from "@/lib/qr";
import { CustomerCardView } from "@/components/stamp-card/CustomerCardView";
import { CustomerPageShell } from "@/components/customer/CustomerPageShell";
import { getCampaignConfig } from "@/lib/campaign-rules.server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sadakat Kartım",
  description: "Puan durumunuz, QR kodunuz ve sipariş geçmişiniz.",
};

export default async function CustomerDashboardPage() {
  const session = await getCustomerSession();
  if (!session) redirect("/customer/login");

  const customer = await getCustomerById(session.customerId);

  if (!customer) {
    redirect("/customer/login");
  }

  const [qrCode, campaign] = await Promise.all([
    generateQrDataUrl(customer.qrUuid),
    getCampaignConfig(),
  ]);

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

