// src/lib/istanbul-time.ts
//
// Türkiye has been on a permanent UTC+3 since 2016 — no DST, no transitions —
// so a fixed offset is exact and needs no tz database. Both the analytics SQL
// (which shifts `created_at` by the same interval before date_trunc) and the
// UI's notion of "the current month" go through this one constant.
export const ISTANBUL_OFFSET_HOURS = 3;

const OFFSET_MS = ISTANBUL_OFFSET_HOURS * 60 * 60 * 1000;

/**
 * The calendar month it currently is in Istanbul.
 *
 * Kept out of component bodies on purpose: `Date.now()` is impure, and calling
 * it during render is flagged by react-hooks/purity. Server Components call
 * this helper instead and pass the result down as props, which also keeps SSR
 * and client hydration in agreement — Vercel runs in UTC, the admin's browser
 * does not.
 *
 * @returns `month` is 0-based, matching JS Date semantics.
 */
export function currentIstanbulMonth(): { year: number; month: number } {
  const shifted = new Date(Date.now() + OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() };
}
