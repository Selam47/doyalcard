"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getRecentActivity, type ActivityItem } from "@/actions/staff-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { usePolledRefresh } from "@/lib/use-polled-refresh";
import { formatClockTime, formatRelativeTime } from "@/lib/relative-time";
import { maskPhone } from "@/lib/utils";

/**
 * How often the feed re-fetches.
 *
 * Was 20s, which on a busy Saturday means every open till device hits the
 * database three times a minute for this section alone — before counting the
 * extra fetches each tab wake-up used to trigger. The relative timestamps keep
 * ticking every {@link TICK_MS} regardless, so the panel still *looks* live
 * between fetches, and a stamp the cashier just applied is reflected by the
 * action's own revalidation rather than by this poll.
 */
const POLL_MS = 60_000;

/** How often the "x dakika önce" labels re-render between fetches. */
const TICK_MS = 15_000;

/** Primary line: WHO the stamp belongs to. Falls back to a masked phone. */
function customerLabel(item: ActivityItem): string {
  const name = item.customerName.trim();
  return name.length > 0 ? name : maskPhone(item.customerPhone);
}

/**
 * Secondary line: WHO performed the stamp, and (for the cross-branch admin
 * view only) where. Explicitly prefixed so the two names on a row can never be
 * misread as "customer, then something about the customer".
 */
function actorLabel(item: ActivityItem, crossBranch: boolean): string {
  const staff = item.staffName?.trim();
  const parts = [`İşlemi yapan: ${staff && staff.length > 0 ? staff : "Silinmiş personel"}`];

  if (crossBranch) {
    parts.push(item.branchName?.trim() || "Şube atanmamış");
  }

  return parts.join(" · ");
}

export function RecentActivitySection() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [crossBranch, setCrossBranch] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [now, setNow] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getRecentActivity();
      if (result.success) {
        setItems(result.items);
        setCrossBranch(result.crossBranch);
        setError(null);
      } else {
        setError(result.error);
      }
    } catch (err) {
      console.error("[RecentActivitySection] fetch failed:", err);
      setError("Son işlemler yüklenemedi.");
    } finally {
      setNow(Date.now());
    }
  }, []);

  // Fetching: one in-flight request at a time, wake-up events deduped, next
  // poll measured from the end of the last fetch. See use-polled-refresh.ts.
  usePolledRefresh(load, { intervalMs: POLL_MS });

  // Re-rendering the "x dakika önce" labels is purely local — no network, no
  // database — so it stays on its own fast timer.
  useEffect(() => {
    const tickId = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(tickId);
  }, []);

  const isLoading = items === null && now === null;

  return (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden">
      <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-5 py-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <span className="text-lg">🧾</span> Son İşlemler
        </h2>
        <p className="text-slate-300 text-xs mt-0.5 leading-normal">
          {crossBranch
            ? "Tüm şubelerdeki son damga hareketleri"
            : "Şubenizdeki son damga hareketleri"}
        </p>
      </div>

      <div className="p-5">
        {isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        )}

        {!isLoading && error && items === null && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠️ {error}
          </p>
        )}

        {!isLoading && items !== null && items.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            <span className="text-4xl mb-2">☕</span>
            <p className="text-gray-400 text-sm text-center">Henüz işlem yok</p>
          </div>
        )}

        {!isLoading && items !== null && items.length > 0 && (
          <ul className="divide-y divide-gray-100">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/staff/customer/${item.customerQrUuid}`}
                  className="flex items-center gap-3 py-3 -mx-2 px-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  {/* Stamp delta badge. `delta` is always +1 today because a
                      correction deletes its Order row rather than writing a
                      negative one — see ActivityItem.delta. */}
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold leading-none ${
                      item.rewardName
                        ? "bg-amber-100 text-amber-700"
                        : "bg-green-100 text-green-700"
                    }`}
                    aria-hidden="true"
                  >
                    {item.rewardName ? "🎁" : `+${item.delta}`}
                  </span>

                  {/*
                    Explicit column + gap + leading on BOTH lines. The two <p>
                    elements previously relied on the line-height that ships
                    with `text-sm`/`text-xs`; any inherited or reset
                    line-height collapsed them onto each other. Pinning
                    `leading-tight`/`leading-normal` and spacing with `gap-0.5`
                    makes the row height independent of inherited typography.
                  */}
                  <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
                    <p className="truncate text-sm font-medium leading-tight text-gray-800">
                      {customerLabel(item)}
                    </p>
                    <p className="truncate text-xs leading-normal text-gray-500">
                      {actorLabel(item, crossBranch)}
                      {item.rewardName && (
                        <span className="text-amber-600"> · {item.rewardName}</span>
                      )}
                    </p>
                  </div>

                  <time
                    dateTime={item.createdAt}
                    title={formatClockTime(item.createdAt)}
                    className="shrink-0 self-center text-xs leading-tight text-gray-400 tabular-nums"
                  >
                    {now === null ? "" : formatRelativeTime(item.createdAt, now)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {/* A failed refresh keeps the last good list on screen — a blank feed
            would read as "no orders today", which is a different fact. */}
        {error && items !== null && items.length > 0 && (
          <p className="mt-3 text-xs text-amber-600">
            Liste güncellenemedi, son bilinen veriler gösteriliyor.
          </p>
        )}
      </div>
    </div>
  );
}
