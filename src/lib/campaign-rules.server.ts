import "server-only";

import { prisma } from "@/lib/prisma";
import {
  type ActiveCampaignRule,
  type CampaignConfig,
  pickCycleRule,
  resolveMaxStamps,
} from "@/lib/campaign-rules";

const RULE_SELECT = {
  id: true,
  threshold: true,
  rewardName: true,
  isResetPoint: true,
} as const;

/**
 * All currently active campaign rules, ordered by threshold ascending.
 * No auth required — this data is already publicly visible on customer cards.
 */
export async function getActiveCampaignRules(): Promise<ActiveCampaignRule[]> {
  return prisma.campaignRule.findMany({
    where: { isActive: true },
    orderBy: { threshold: "asc" },
    select: RULE_SELECT,
  });
}

/**
 * The one call every stamp-rendering page/server-action should make.
 * Returns the active rules (for milestone styling) plus the authoritative
 * `maxStamps` used for the "x / maxStamps" counters and the grid size.
 */
export async function getCampaignConfig(): Promise<CampaignConfig> {
  const rules = await getActiveCampaignRules();
  const cycleRule = pickCycleRule(rules);
  return { rules, cycleRule, maxStamps: resolveMaxStamps(cycleRule) };
}
