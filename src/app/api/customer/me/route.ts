import { NextResponse } from "next/server";

import { getCustomerSession } from "@/lib/customer-session";
import { prisma } from "@/lib/prisma";
import { isDbConnectionError } from "@/lib/db-errors";
import { clampCycleCount } from "@/lib/campaign-rules";
import { getCampaignConfig } from "@/lib/campaign-rules.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getCustomerSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [customer, campaign] = await Promise.all([
      prisma.customer.findUnique({
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
      }),
      getCampaignConfig(),
    ]);

    if (!customer) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const { rules, cycleRule, maxStamps } = campaign;
    const cycleCount = clampCycleCount(customer.currentCycleCount, maxStamps);

    const targetRule =
      rules.find((r) => r.threshold > cycleCount) ?? cycleRule;

    return NextResponse.json({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      qrUuid: customer.qrUuid,
      currentCycleCount: cycleCount,
      lifetimeCount: customer.lifetimeCount,
      maxStamps,
      createdAt: customer.createdAt,
      nextThreshold: targetRule?.threshold ?? null,
      nextRewardName: targetRule?.rewardName ?? null,
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
  } catch (err) {
    console.error("[customer/me]", err);

    if (isDbConnectionError(err)) {
      return NextResponse.json(
        { error: "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin." },
        { status: 503 }
      );
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
