// src/lib/campaign-rules.server.ts
//
// SERVER-ONLY database access for campaign rules. This file (and anything
// it imports) must never end up in a client bundle — it pulls in `prisma`
// (and transitively `pg`, which needs Node's `tls`/`net` modules and breaks
// Webpack's client build with "Module not found: Can't resolve 'tls'").
//
// The `server-only` import below makes any accidental client-side import
// fail loudly at build time instead of silently breaking the bundle.
//
// Pure/shared helpers (types, `clampCycleCount`, `pickCycleRule`,
// `resolveMaxStamps`, etc.) that client components ALSO need live in
// `@/lib/campaign-rules` (no `prisma` import there). Client components must
// only ever import from that file, never from this one.
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
 * Fetch the SINGLE active campaign rule that defines the cycle, straight from
 * the database. Ordering makes the pick deterministic even if an admin leaves
 * several rules active at once.
 */
export async function getActiveCycleRule(): Promise<ActiveCampaignRule | null> {
  return prisma.campaignRule.findFirst({
    where: { isActive: true },
    orderBy: [{ isResetPoint: "desc" }, { threshold: "desc" }],
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
