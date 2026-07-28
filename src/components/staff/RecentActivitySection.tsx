"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getRecentActivity, type ActivityItem } from "@/actions/staff-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { formatClockTime, formatRelativeTime } from "@/lib/relative-time";
import { maskPhone } from "@/lib/utils";

/** How often the feed re-fetches. Slow enough to be free, fast enough to feel live. */
const POLL_MS = 20_000;

/** How often the "x dakika önce" labels re-render between fetches. */
const TICK_MS = 15_000;

function displayName(item: ActivityItem): string {
  const name = item.customerName.trim();
  return name.length > 0 ? name : maskPhone(item.customerPhone);
}

export function RecentActivitySection() {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `now` lives in state rather than being read during render: Date.now() in a
  // render body is impure (react-hooks/purity) and would also make the server
  // and client disagree at hydration. It starts null, which is one of the two
  // conditions for showing the skeleton below.
  const [now, setNow] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getRecentActivity();
      if (result.success) {
        setItems(result.items);
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

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      // A backgrounded tab (the cashier switched apps) would otherwise keep
      // hitting the DB for a list nobody is looking at. The visibilitychange
      // listener below fetches immediately when they come back, so the feed is
      // never stale on screen.
      if (document.visibilityState === "hidden") return;
      if (!cancelled) void load();
    };

    // Deferred to a microtask rather than called straight from the effect
    // body: `load()` resolves its first `setState` eagerly enough that the
    // React Compiler's `react-hooks/set-state-in-effect` rule treats it as a
    // synchronous set, which would cascade an extra render pass. Queuing it
    // moves the state write past the effect's own commit.
    queueMicrotask(() => {
      if (!cancelled) void load();
    });

    const pollId = window.setInterval(refresh, POLL_MS);
    const tickId = window.setInterval(() => {
      if (!cancelled) setNow(Date.now());
    }, TICK_MS);

    document.addEventListener("visibilitychange", refresh);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      window.clearInterval(tickId);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const isLoading = items === null && now === null;

  return (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden">
      <div className="bg-gradient-to-r from-slate-700 to-slate-600 px-5 py-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <span className="text-lg">🧾</span> Son İşlemler
        </h2>
        <p className="text-slate-300 text-xs mt-0.5">
          Şubenizdeki son damga hareketleri
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
                  href={`/card/${item.customerQrUuid}`}
                  className="flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm ${
                      item.rewardName
                        ? "bg-amber-100 text-amber-700"
                        : "bg-green-100 text-green-700"
                    }`}
                    aria-hidden="true"
                  >
                    {item.rewardName ? "🎁" : "+1"}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {displayName(item)}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {item.staffName ?? "Silinmiş personel"}
                      {item.rewardName && (
                        <span className="text-amber-600">
                          {" "}
                          · {item.rewardName}
                        </span>
                      )}
                    </p>
                  </div>

                  <time
                    dateTime={item.createdAt}
                    title={formatClockTime(item.createdAt)}
                    className="shrink-0 text-xs text-gray-400 tabular-nums"
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
