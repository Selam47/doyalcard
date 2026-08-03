export const SYSTEM_START_YEAR = 2026;
/** 0-based, matching JS Date semantics → July. */
export const SYSTEM_START_MONTH = 6;

/**
 * Absolute month number (`year * 12 + month`).
 *
 * Turns every range question — "is this before launch?", "how many months fit
 * in the window?" — into plain arithmetic instead of nested year/month checks.
 */
export function monthIndex(year: number, month: number): number {
  return year * 12 + month;
}

export const SYSTEM_START_INDEX = monthIndex(
  SYSTEM_START_YEAR,
  SYSTEM_START_MONTH
);
