"use client";

// src/app/admin/error.tsx
//
// Admin-panel boundary. This one earns its keep on day one: three read actions
// in src/actions/admin.ts — getCampaignRules(), getBranches() and
// getStaffUsers() — still go through requireAdmin(), which THROWS rather than
// returning a result object. They are awaited directly inside the server
// components for /admin/rules, /admin/branches and /admin/staff, so any
// database hiccup on those pages raises during render. Without this file the
// admin got a bare Next.js error screen.
//
// (Converting those three to the {success, data|error} contract is the real
// fix; it was deliberately left out of the pre-launch change set to avoid
// touching working admin code the night before go-live.)
//
// The audience here is the owner, not a customer, so the copy can name the
// likely cause — but it still shows only `error.digest`, never the message.

import { useEffect } from "react";
import Link from "next/link";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[admin/error]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md py-10">
      <div className="rounded-2xl border border-red-200 bg-white p-6 text-center shadow-lg">
        <span className="text-5xl">📊</span>
        <h1 className="mt-4 text-xl font-bold text-gray-800">
          Yönetim paneli yüklenemedi
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Genellikle geçici bir veritabanı bağlantı sorunudur. Bu ekran{" "}
          <strong>kasa işlemlerini etkilemez</strong> — personel paneli
          çalışmaya devam eder.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={reset}
            className="w-full rounded-xl bg-green-600 px-5 py-3 font-semibold text-white transition-colors hover:bg-green-500"
          >
            Tekrar Dene
          </button>
          <Link
            href="/staff"
            className="w-full rounded-xl border border-gray-300 px-5 py-3 font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            Personel Paneline Git
          </Link>
        </div>

        {error.digest && (
          <p className="mt-5 font-mono text-[11px] text-gray-400">
            Hata kodu: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
