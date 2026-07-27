// src/lib/campaign-rules.ts
// Shared helpers for reading *active* campaign rules from the database.
// Any UI that displays stamp/cycle progress (customer card, staff panel,
// public landing page) must derive its numbers from here rather than
// hardcoding thresholds — campaign rules are fully admin-configurable via
// /admin/rules and can change at any time.

import { prisma } from "@/lib/prisma";

export interface ActiveCampaignRule {
  id: string;
  threshold: number;
  rewardName: string;
  isResetPoint: boolean;
}

/**
 * Fetch all currently active campaign rules, ordered by threshold ascending.
 * No auth required — this data is already publicly visible on customer cards
 * and the public landing page.
 */
export async function getActiveCampaignRules(): Promise<ActiveCampaignRule[]> {
  return prisma.campaignRule.findMany({
    where: { isActive: true },
    orderBy: { threshold: "asc" },
    select: {
      id: true,
      threshold: true,
      rewardName: true,
      isResetPoint: true,
    },
  });
}

/**
 * The length of one full stamp cycle — i.e. the threshold at which the
 * customer's current_cycle_count resets to 0 (see addOrder in
 * src/actions/order.ts). Falls back to the highest active threshold if no
 * rule is flagged as a reset point, and to 0 if there are no active rules
 * at all (caller should handle that case gracefully, e.g. hide the grid).
 */
export function getCycleLength(rules: ActiveCampaignRule[]): number {
  const resetRule = rules.find((r) => r.isResetPoint);
  if (resetRule) return resetRule.threshold;
  if (rules.length > 0) return Math.max(...rules.map((r) => r.threshold));
  return 0;
}
