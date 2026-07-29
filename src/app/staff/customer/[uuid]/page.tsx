// src/app/staff/customer/[uuid]/page.tsx
//
// STAFF TILL — the only surface in the app that renders stamp/delete controls.
//
// Three independent layers have to agree before a button reaches the screen:
//   1. middleware.ts — /staff/* requires a STAFF or ADMIN token (Edge).
//   2. src/app/staff/layout.tsx — re-checks the session server-side.
//   3. resolveStaffCardAccess() below — re-reads the user row from the
//      DATABASE, so a deactivated or demoted account is locked out
//      immediately rather than at token expiry.
//
// And a fourth, independent of all rendering: every action (addOrder,
// removeStamp, claimReward, deleteCustomer) re-runs authorizeStaff() itself,
// because Server Actions are publicly callable endpoints.
import type { Metadata } from "next";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { resolveStaffCardAccess } from "@/lib/card-access";
import { CustomerCardView } from "@/components/stamp-card/CustomerCardView";
import { StaffActionPanel } from "@/components/staff/StaffActionPanel";
import { generateQrDataUrl } from "@/lib/qr";
import { getCampaignConfig } from "@/lib/campaign-rules.server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Personel İşlem Paneli",
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ uuid: string }>;
}

export default async function StaffCustomerPage({ params }: Props) {
  const { uuid } = await params;

  const access = await resolveStaffCardAccess(uuid);

  // A customer session can never satisfy this route — only an active
  // STAFF/ADMIN user row does.
  if (access.status === "unauthorized") redirect("/login");
  if (access.status === "not-found") notFound();

  const { customer, staff } = access;

  const [qrDataUrl, campaign] = await Promise.all([
    generateQrDataUrl(uuid),
    getCampaignConfig(),
  ]);

  const { rules: activeRules, maxStamps } = campaign;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/staff"
          className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
        >
          ← Personel Paneli
        </Link>
        <span className="text-xs bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full font-semibold">
          {staff.isAdmin ? "Yönetici" : "Personel"} Görünümü
        </span>
      </div>

      {/*
        Status first, actions second. The cashier confirms WHOSE card this is
        and where the cycle stands before any mutating button is in reach —
        which also keeps the destructive "Tehlikeli Bölge" (rendered at the
        foot of StaffActionPanel) at the very bottom of the whole view.
      */}
      <CustomerCardView
        customer={customer}
        qrDataUrl={qrDataUrl}
        activeRules={activeRules}
        maxStamps={maxStamps}
      />

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
          .map((r) => ({
            id: r.id,
            rewardName: r.rule.rewardName,
            createdAt: r.createdAt,
          }))}
        maxStamps={maxStamps}
        // Visibility only — deleteCustomer re-checks ADMIN against the DB.
        isAdmin={staff.isAdmin}
      />
    </div>
  );
}
