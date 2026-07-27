// src/lib/campaign-rules.ts
//
// SINGLE SOURCE OF TRUTH for stamp-card sizing.
//
// Every surface that renders "x / maxStamps" — the customer card
// (/card/[uuid]), the customer dashboard (/customer/dashboard), the staff
// action panel and the public landing page — MUST derive its numbers from
// here. Nothing may read a per-customer legacy value or a hardcoded limit:
// the active CampaignRule row in the database is the only authority, so
// changing the threshold in /admin/rules to 10, 15, 20 or 40 instantly and
// uniformly changes every card in the system.

import { prisma } from "@/lib/prisma";

export interface ActiveCampaignRule {
  id: string;
  threshold: number;
  rewardName: string;
  isResetPoint: boolean;
}

export interface CampaignConfig {
  /** All active rules (milestones + the cycle rule), ascending by threshold. */
  rules: ActiveCampaignRule[];
  /** The one active rule that defines the length of a full stamp cycle. */
  cycleRule: ActiveCampaignRule | null;
  /** Total stamp slots on every card. Always > 0. */
  maxStamps: number;
}

const RULE_SELECT = {
  id: true,
  threshold: true,
  rewardName: true,
  isResetPoint: true,
} as const;

/**
 * Absolute fallback used ONLY when the `campaign_rules` table contains no
 * active row at all (fresh install, before an admin configures a campaign).
 * This is the one and only hardcoded number in the system.
 */
export const DEFAULT_CYCLE_LENGTH = 15;

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
 * Pick THE single rule that governs the cycle length out of a set of active
 * rules. Deterministic and shared by the server actions (which read rules
 * inside their transaction) and the page loaders, so both always agree.
 *
 * Priority: the rule flagged `isResetPoint` → otherwise the highest threshold.
 */
export function pickCycleRule(
  rules: ActiveCampaignRule[]
): ActiveCampaignRule | null {
  if (rules.length === 0) return null;
  const resetRule = rules.find((r) => r.isResetPoint);
  if (resetRule) return resetRule;
  return rules.reduce((best, r) => (r.threshold > best.threshold ? r : best));
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

/** Turn the active cycle rule into a usable, always-positive stamp count. */
export function resolveMaxStamps(cycleRule: ActiveCampaignRule | null): number {
  const threshold = cycleRule?.threshold ?? 0;
  return Number.isInteger(threshold) && threshold > 0
    ? threshold
    : DEFAULT_CYCLE_LENGTH;
}

/**
 * The one call every stamp-rendering page should make.
 * Returns the active rules (for milestone styling) plus the authoritative
 * `maxStamps` used for the "x / maxStamps" counters and the grid size.
 */
export async function getCampaignConfig(): Promise<CampaignConfig> {
  const rules = await getActiveCampaignRules();
  const cycleRule = pickCycleRule(rules);
  return { rules, cycleRule, maxStamps: resolveMaxStamps(cycleRule) };
}

/**
 * Defensive display clamp for legacy customer rows whose stored
 * `current_cycle_count` is larger than the currently active threshold
 * (e.g. a customer sat on 12 stamps when the admin lowered the campaign to 7).
 * Their next order self-heals the stored value (see addOrder), but until then
 * the UI must never render "12/7" or paint more stamps than the grid has.
 */
export function clampCycleCount(count: number, maxStamps: number): number {
  if (!Number.isFinite(count) || count <= 0) return 0;
  return Math.min(Math.floor(count), maxStamps);
}

/**
 * @deprecated Use `getCampaignConfig()` / `resolveMaxStamps()` instead.
 * Kept as a thin alias so any remaining caller resolves the identical number.
 */
export function getCycleLength(rules: ActiveCampaignRule[]): number {
  return resolveMaxStamps(pickCycleRule(rules));
}
