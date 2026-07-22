// src/app/customer/login/page.tsx
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCustomerSession } from "@/lib/customer-session";
import { CustomerPhoneLoginForm } from "@/components/customer/CustomerPhoneLoginForm";

export const metadata: Metadata = {
  title: "Müşteri Girişi",
  description: "Telefon numaranızla giriş yapın, sadakat kartınıza erişin.",
};

export default async function CustomerLoginPage() {
  // If already logged in, redirect straight to dashboard
  const session = await getCustomerSession();
  if (session) redirect("/customer/dashboard");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-green-950 via-green-900 to-emerald-800 p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-green-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-emerald-400/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-green-600/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-green-500 shadow-2xl shadow-green-900/50 mb-4">
            <span className="text-4xl" role="img" aria-label="döner">🫓</span>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            Ekrem Coşkun Döner
          </h1>
          <p className="text-green-300 mt-1 text-sm">Sadakat Kartı — Müşteri Girişi</p>
        </div>

        {/* Card */}
        <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-2xl p-8 shadow-2xl">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white">Hoş Geldiniz</h2>
            <p className="text-green-300/80 text-sm mt-1">
              Telefon numaranızla giriş yapın veya yeni hesap oluşturun.
            </p>
          </div>

          <CustomerPhoneLoginForm />
        </div>

        {/* Personel link */}
        <p className="text-center text-xs text-white/40 mt-6">
          Personel misiniz?{" "}
          <a href="/login" className="text-green-300 hover:text-white transition-colors underline">
            Personel Girişi
          </a>
        </p>
      </div>
    </div>
  );
}
