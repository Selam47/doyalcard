"use client";

// src/lib/use-polled-refresh.ts
//
// Shared polling loop for the /staff dashboard sections.
//
// Both sections used to run `setInterval(refresh, 20_000)` AND attach
// `refresh` directly to `visibilitychange`, `focus` and `pageshow`. Every till
// device is a phone or tablet that is constantly being woken, so in practice:
//
//   • bringing the tab forward fires `visibilitychange` AND `focus` — two full
//     round trips back-to-back, for the same data;
//   • those wake-ups did not reset the interval, so a fetch triggered at t+19s
//     was followed by the scheduled one at t+20s;
//   • nothing prevented a second fetch from starting while the first was still
//     in flight on a slow connection.
//
// This hook keeps the same "feels live" behaviour and removes the stacking:
//
//   • a self-rescheduling `setTimeout` chain instead of `setInterval`, so the
//     next poll is always a full interval after the LAST fetch, whatever
//     triggered it;
//   • one in-flight fetch at a time;
//   • a minimum gap between wake-triggered fetches, which collapses the
//     `visibilitychange` + `focus` pair into a single request;
//   • no fetch at all while the tab is hidden — but the chain keeps ticking so
//     it recovers on its own when the tab comes back, rather than depending on
//     an event that may not fire.

import { useEffect } from "react";

interface Options {
  /** Time between polls, measured from the end of the previous fetch. */
  intervalMs: number;
  /**
   * Minimum spacing for wake-triggered refreshes. Defaults to 5s (or the poll
   * interval, whichever is smaller) — long enough to swallow the duplicate
   * events a single tab-focus produces, short enough that a cashier returning
   * to the till still gets fresh data immediately.
   */
  minGapMs?: number;
}

/**
 * Run `load` on mount, then on an interval, then whenever the tab is woken —
 * without ever running it twice concurrently or twice in quick succession.
 *
 * `load` MUST be referentially stable (wrap it in `useCallback`), and is
 * expected to handle its own errors; a rejection here is swallowed so it can
 * never break the polling chain.
 */
export function usePolledRefresh(
  load: () => Promise<void> | void,
  { intervalMs, minGapMs }: Options
): void {
  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    let lastRunAt = 0;
    let timerId: number | undefined;

    const gap = minGapMs ?? Math.min(5_000, intervalMs);

    const schedule = () => {
      if (cancelled) return;
      if (timerId !== undefined) window.clearTimeout(timerId);
      timerId = window.setTimeout(() => void run(true), intervalMs);
    };

    /**
     * @param force Skip the min-gap check (the scheduled tick and the very
     *              first load); wake-up events pass `false`.
     */
    const run = async (force: boolean): Promise<void> => {
      if (cancelled) return;

      const hidden = document.visibilityState === "hidden";
      const tooSoon = !force && Date.now() - lastRunAt < gap;

      if (!inFlight && !hidden && !tooSoon) {
        inFlight = true;
        lastRunAt = Date.now();
        try {
          await load();
        } catch {
          // `load` owns its error state; never let it kill the chain.
        } finally {
          inFlight = false;
        }
      }

      // Every path reschedules — including the skipped ones. A hidden tab
      // therefore keeps a cheap no-op timer alive instead of silently ending
      // the loop and leaving the section frozen until some event happens to
      // fire.
      if (!cancelled) schedule();
    };

    void run(true);

    const onWake = () => void run(false);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", onWake);
    window.addEventListener("pageshow", onWake);

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", onWake);
      window.removeEventListener("pageshow", onWake);
    };
  }, [load, intervalMs, minGapMs]);
}
