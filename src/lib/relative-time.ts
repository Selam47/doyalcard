// src/lib/relative-time.ts
//
// Turkish relative timestamps ("5 dakika önce") for the staff panel's activity
// feed. Pure and client-safe — no `prisma`, no `server-only`, no Date.now()
// inside the module. The caller passes both instants explicitly, which keeps
// the calling component's render pure (react-hooks/purity) and lets the feed
// re-label itself from a single ticking `now` in state.
//
// Hand-rolled rather than Intl.RelativeTimeFormat("tr") on purpose: the same
// reasoning as MonthlyAnalytics' month labels — a Node build without full ICU
// silently falls back to English, which would disagree with the browser.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Format the distance between `then` and `now` in Turkish, past tense.
 *
 * Anything under a minute reads "az önce" — a cashier does not care whether a
 * stamp landed 8 or 40 seconds ago, and it avoids a label that changes on
 * every render tick.
 *
 * @param then The moment the event happened (ISO string or Date).
 * @param now  The reference "current" moment, in epoch ms.
 */
export function formatRelativeTime(then: string | Date, now: number): string {
  const ts = then instanceof Date ? then.getTime() : new Date(then).getTime();
  if (!Number.isFinite(ts)) return "";

  // A clock skew between the DB server and the browser can put a fresh row a
  // few seconds into the "future"; clamp instead of rendering "-1 dakika önce".
  const diff = Math.max(0, now - ts);

  if (diff < MINUTE) return "az önce";

  const minutes = Math.floor(diff / MINUTE);
  if (minutes < 60) return `${minutes} dakika önce`;

  const hours = Math.floor(diff / HOUR);
  if (hours < 24) return `${hours} saat önce`;

  const days = Math.floor(diff / DAY);
  if (days < 7) return `${days} gün önce`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks} hafta önce`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ay önce`;

  return `${Math.floor(days / 365)} yıl önce`;
}

/** Exact Istanbul-local clock time ("14:32"), used as the row's title tooltip. */
export function formatClockTime(then: string | Date): string {
  const date = then instanceof Date ? then : new Date(then);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Istanbul",
  });
}
