// src/app/api/customer/me/route.ts
// Returns the authenticated customer's full dashboard data.

import { NextResponse } from "next/server";
import { getCustomerSession } from "@/lib/customer-session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
        take: 5,
        include: { rule: true },
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  // Find the next campaign rule threshold (lowest active rule > currentCycleCount)
  const nextRule = await prisma.campaignRule.findFirst({
    where: {
      isActive: true,
      threshold: { gt: customer.currentCycleCount },
    },
    orderBy: { threshold: "asc" },
  });

  // Fallback: if no rule above current count, get highest active threshold
  const highestRule = await prisma.campaignRule.findFirst({
    where: { isActive: true },
    orderBy: { threshold: "desc" },
  });

  const targetRule = nextRule ?? highestRule;

  return NextResponse.json({
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    qrUuid: customer.qrUuid,
    currentCycleCount: customer.currentCycleCount,
    lifetimeCount: customer.lifetimeCount,
    createdAt: customer.createdAt,
    nextThreshold: targetRule?.threshold ?? 11,
    nextRewardName: targetRule?.rewardName ?? "Ödül",
    orders: customer.orders.map((o) => ({
      id: o.id,
      createdAt: o.createdAt,
      rewardName: o.reward?.rule?.rewardName ?? null,
      rewardStatus: o.reward?.status ?? null,
    })),
    rewards: customer.rewards.map((r) => ({
      id: r.id,
      rewardName: r.rule.rewardName,
      status: r.status,
      createdAt: r.createdAt,
      claimedAt: r.claimedAt,
    })),
  });
}
