// src/app/customer/dashboard/page.tsx
// Protected server component — reads session, fetches data, passes to client.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCustomerSession } from "@/lib/customer-session";
import { prisma } from "@/lib/prisma";
import { CustomerDashboard } from "@/components/customer/CustomerDashboard";

export const metadata: Metadata = {
  title: "Sadakat Kartım",
  description: "Puan durumunuz, QR kodunuz ve sipariş geçmişiniz.",
};

export default async function CustomerDashboardPage() {
  // ── Auth guard ────────────────────────────────────────────────────────────
  const session = await getCustomerSession();
  if (!session) redirect("/customer/login");

  // ── Fetch customer data ───────────────────────────────────────────────────
  const customer = await prisma.customer.findUnique({
    where: { id: session.customerId },
    include: {
      orders: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          reward: {
            include: { rule: true },
          },
        },
      },
      rewards: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: { rule: true },
      },
    },
  });

  if (!customer) {
    // Session refers to a deleted customer — clear and redirect
    redirect("/customer/login");
  }

  // ── Determine next reward threshold ──────────────────────────────────────
  const nextRule = await prisma.campaignRule.findFirst({
    where: {
      isActive: true,
      threshold: { gt: customer.currentCycleCount },
    },
    orderBy: { threshold: "asc" },
  });

  const highestRule = await prisma.campaignRule.findFirst({
    where: { isActive: true },
    orderBy: { threshold: "desc" },
  });

  const targetRule = nextRule ?? highestRule;

  // ── Build serialisable prop ───────────────────────────────────────────────
  const data = {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    qrUuid: customer.qrUuid,
    currentCycleCount: customer.currentCycleCount,
    lifetimeCount: customer.lifetimeCount,
    createdAt: customer.createdAt.toISOString(),
    nextThreshold: targetRule?.threshold ?? 11,
    nextRewardName: targetRule?.rewardName ?? "Ödül",
    orders: customer.orders.map((o) => ({
      id: o.id,
      createdAt: o.createdAt.toISOString(),
      rewardName: o.reward?.rule?.rewardName ?? null,
      rewardStatus: o.reward?.status ?? null,
    })),
    rewards: customer.rewards.map((r) => ({
      id: r.id,
      rewardName: r.rule.rewardName,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      claimedAt: r.claimedAt?.toISOString() ?? null,
    })),
  };

  return <CustomerDashboard initialData={data} />;
}
