"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  getCustomersNearReward,
  type NearRewardCustomer,
} from "@/actions/staff-dashboard";
import { Skeleton } from "@/components/ui/skeleton";
import { maskPhone } from "@/lib/utils";

/** Rows shown before "tümünü gör" is pressed. */
const COLLAPSED_LIMIT = 8;

/** Kept in step with the activity feed so both sections refresh together. */
const POLL_MS = 20_000;

function displayName(customer: NearRewardCustomer): string {
  const name = customer.name.trim();
  return name.length > 0 ? name : maskPhone(customer.phone);
}

export function NearRewardSection() {
  const [customers, setCustomers] = useState<NearRewardCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getCustomersNearReward();
      if (result.success) {
        setCustomers(result.customers);
        setError(null);
      } else {
        setError(result.error);
        // Distinguish "never loaded" from "reload failed" — an empty list is a
        // meaningful answer, a null one is not.
        setCustomers((prev) => prev ?? []);
      }
    } catch (err) {
      console.error("[NearRewardSection] fetch failed:", err);
      setError("Ödüle yaklaşan müşteriler yüklenemedi.");
      setCustomers((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      if (!cancelled) void load();
    };

    void load();

    const pollId = window.setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const isLoading = customers === null;
  const visible = expanded ? customers : customers?.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = (customers?.length ?? 0) - COLLAPSED_LIMIT;

  return (
    <div className="bg-white rounded-2xl shadow-md overflow-hidden">
      <div className="bg-gradient-to-r from-amber-600 to-orange-500 px-5 py-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <span className="text-lg">🎯</span> Ödüle Yaklaşanlar
        </h2>
        <p className="text-amber-100 text-xs mt-0.5">
          Bir sonraki ödülüne 1–2 damga kalan müşteriler
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
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isLoading && error && customers.length === 0 && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            ⚠️ {error}
          </p>
        )}

        {!isLoading && !error && customers.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
            <span className="text-4xl mb-2">🎯</span>
            <p className="text-gray-400 text-sm text-center">
              Ödüle yaklaşan müşteri yok
            </p>
          </div>
        )}

        {!isLoading && visible && visible.length > 0 && (
          <>
            <ul className="divide-y divide-gray-100">
              {visible.map((customer) => {
                const isOneAway = customer.remaining === 1;

                return (
                  <li key={customer.id}>
                    <Link
                      href={`/card/${customer.qrUuid}`}
                      className="flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums ${
                          isOneAway
                            ? "bg-amber-100 text-amber-700 ring-2 ring-amber-300"
                            : "bg-gray-100 text-gray-600"
                        }`}
                        aria-hidden="true"
                      >
                        {customer.currentCycleCount}/{customer.nextThreshold}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-800 truncate flex items-center gap-1.5">
                          {displayName(customer)}
                          {isOneAway && (
                            <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                              🔥 SON DAMGA
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          <span
                            className={
                              isOneAway
                                ? "font-semibold text-amber-700"
                                : "text-gray-600"
                            }
                          >
                            {customer.remaining} damga kaldı
                          </span>{" "}
                          → {customer.nextRewardName}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>

            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-3 w-full rounded-lg py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
              >
                {expanded ? "daha az göster" : `tümünü gör (+${hiddenCount})`}
              </button>
            )}
          </>
        )}

        {error && customers !== null && customers.length > 0 && (
          <p className="mt-3 text-xs text-amber-600">
            Liste güncellenemedi, son bilinen veriler gösteriliyor.
          </p>
        )}
      </div>
    </div>
  );
}
