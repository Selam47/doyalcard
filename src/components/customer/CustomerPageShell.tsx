"use client";

// src/components/customer/CustomerPageShell.tsx
// Thin wrapper rendered around CustomerCardView for logged-in customers.
// Provides the sticky header + logout button; keeps CustomerCardView itself pure.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { maskPhone } from "@/lib/utils";

interface Props {
  customerName: string;
  customerPhone: string;
  children: React.ReactNode;
}

export function CustomerPageShell({ customerName, customerPhone, children }: Props) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await fetch("/api/customer/logout", { method: "POST" });
      router.push("/customer/login");
      router.refresh();
    } catch {
      toast.error("Çıkış yapılamadı.");
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-950 via-green-900 to-emerald-800">
      {/* ── Sticky header ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-green-950/80 backdrop-blur-xl border-b border-white/10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl" role="img" aria-label="döner">🫓</span>
            <div>
              <p className="text-white font-semibold text-sm leading-none">
                {customerName === "Müşteri" ? "Sadakat Kartım" : customerName}
              </p>
              <p className="text-green-400 text-xs mt-0.5">{maskPhone(customerPhone)}</p>
            </div>
          </div>

          <button
            id="sign-out-btn"
            onClick={handleSignOut}
            disabled={signingOut}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm transition-all disabled:opacity-60"
          >
            {signingOut ? (
              <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            )}
            Çıkış
          </button>
        </div>
      </header>

      {/* ── Page content (CustomerCardView injected here) ───────────────── */}
      <main className="max-w-2xl mx-auto px-4 py-6 pb-12 space-y-4">
        {children}
      </main>
    </div>
  );
}
