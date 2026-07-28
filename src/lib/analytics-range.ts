// src/lib/analytics-range.ts
//
// The month the loyalty system went live. Nothing in the database predates it,
// so a plain "last 12 months" window would pad the trend chart with empty
// months from before the business ever issued a stamp — visually
// indistinguishable from a period of zero activity. Every range (trend window,
// month selector, month-over-month baseline) clamps to this floor instead.
//
// Shared by the Server Action and the Client Component: keeping it in a plain
// lib module rather than in `@/actions/analytics` matters, because a
// `"use server"` file may only export async functions.
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
