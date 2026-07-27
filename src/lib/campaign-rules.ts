// src/lib/campaign-rules.ts
//
// SINGLE SOURCE OF TRUTH for stamp-card sizing — the PURE, CLIENT-SAFE half.
//
// This file must NEVER import `prisma` (or anything else server-only). It is
// imported directly by client components (e.g. StaffActionPanel.tsx) as well
// as by server code, so it can only contain plain functions/types with no
// side effects and no database access.
//
// The database-backed lookups (`getActiveCampaignRules`, `getActiveCycleRule`,
// `getCampaignConfig`) live in `@/lib/campaign-rules.server` instead, guarded
// by `import "server-only"`. Server components, route handlers, and server
// actions should import those from `campaign-rules.server`; everything below
// stays safe to import from either side.
//
// Every surface that renders "x / maxStamps" — the customer card
// (/card/[uuid]), the customer dashboard (/customer/dashboard), the staff
// action panel and the public landing page — MUST derive its numbers from
// the active CampaignRule row in the database (via campaign-rules.server),
// then use the helpers here to compute/display them. Nothing may read a
// per-customer legacy value or a hardcoded limit.

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

/**
 * Absolute fallback used ONLY when the `campaign_rules` table contains no
 * active row at all (fresh install, before an admin configures a campaign).
 * This is the one and only hardcoded number in the system.
 */
export const DEFAULT_CYCLE_LENGTH = 15;

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

/** Turn the active cycle rule into a usable, always-positive stamp count. */
export function resolveMaxStamps(cycleRule: ActiveCampaignRule | null): number {
  const threshold = cycleRule?.threshold ?? 0;
  return Number.isInteger(threshold) && threshold > 0
    ? threshold
    : DEFAULT_CYCLE_LENGTH;
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
 * @deprecated Use `getCampaignConfig()` (from `@/lib/campaign-rules.server`)
 * / `resolveMaxStamps()` instead. Kept as a thin alias so any remaining
 * caller resolves the identical number.
 */
export function getCycleLength(rules: ActiveCampaignRule[]): number {
  return resolveMaxStamps(pickCycleRule(rules));
}
