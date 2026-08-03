import type { Metadata } from "next";

import Link from "next/link";
import { getCustomerSession } from "@/lib/customer-session";
import { prisma } from "@/lib/prisma";
import { maskPhone } from "@/lib/utils";
import { CustomerPhoneLoginForm } from "@/components/customer/CustomerPhoneLoginForm";

export const metadata: Metadata = {
  title: "Müşteri Girişi",
  description: "Telefon numaranızla giriş yapın, sadakat kartınıza erişin.",
};

interface CustomerLoginPageProps {
  searchParams: Promise<{ callbackUrl?: string | string[] }>;
}

const CARD_PATH_PATTERN =
  /^\/card\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSafeDestination(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return "/customer/dashboard";

  try {
    const url = new URL(candidate, "http://customer-login.local");
    if (url.origin !== "http://customer-login.local") {
      return "/customer/dashboard";
    }
    if (!CARD_PATH_PATTERN.test(url.pathname)) {
      return "/customer/dashboard";
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/customer/dashboard";
  }
}

/**
 * Who, if anyone, is this browser already signed in as?
 *
 * Returned so the page can NAME them instead of silently acting on their
 * behalf. The projection is deliberately just enough to identify the account
 * to its owner — the phone is masked before it reaches the client.
 */
async function getExistingIdentity(
  customerId: string,
  sessionPhone: string
): Promise<{ name: string; maskedPhone: string } | null> {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { name: true, phone: true },
    });

    // Same session/record cross-check the dashboard applies. A session that no
    // longer agrees with its row is not an identity worth offering.
    if (!customer || customer.phone !== sessionPhone) return null;

    return {
      name: customer.name === "Müşteri" ? "Sadakat Kartım" : customer.name,
      maskedPhone: maskPhone(customer.phone),
    };
  } catch (error) {
    console.error("[customer/login] existing identity lookup failed:", error);
    return null;
  }
}

export default async function CustomerLoginPage({
  searchParams,
}: CustomerLoginPageProps) {
  const [session, params] = await Promise.all([
    getCustomerSession(),
    searchParams,
  ]);
  const redirectTo = getSafeDestination(params.callbackUrl);
  const returningToCard = redirectTo.startsWith("/card/");

  /*
   * A LIVE SESSION NO LONGER REDIRECTS ON ITS OWN.
   *
   * This page used to hand the client `alreadyLoggedIn` and have it fire
   * `router.replace(redirectTo)` from an effect. On a device where somebody
   * else had signed in earlier — the owner testing a second number, a shared
   * counter phone, a family handset — the session cookie outlives the visit
   * (it is a session cookie, and a mobile browser is essentially never fully
   * closed). Anyone opening the login page was then thrown straight onto THAT
   * person's dashboard, complete with their name, masked number, stamp count
   * and QR code, without entering a phone number or an OTP. Arriving here is a
   * statement of intent to sign in, so the previous occupant is now shown by
   * name and the visitor chooses explicitly.
   */
  const existingIdentity = session
    ? await getExistingIdentity(session.customerId, session.phone)
    : null;

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
              {returningToCard
                ? "Kartınızı güvenli şekilde görüntülemek için giriş yapın."
                : "Telefon numaranızla giriş yapın veya yeni hesap oluşturun."}
            </p>
          </div>

          <CustomerPhoneLoginForm
            existingIdentity={existingIdentity}
            redirectTo={redirectTo}
          />
        </div>

        <div className="text-center text-xs text-white/40 mt-6 space-y-2">
          {returningToCard && (
            <p>
              <Link href="/" className="text-green-300 hover:text-white transition-colors underline">
                Ana sayfaya dön
              </Link>
            </p>
          )}
          <p>
            Personel misiniz?{" "}
            <Link href="/login" className="text-green-300 hover:text-white transition-colors underline">
              Personel Girişi
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
