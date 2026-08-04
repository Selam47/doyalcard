// src/app/api/customer/exists/route.ts
//
// The pre-OTP question the customer login screen asks BEFORE spending an SMS:
// "is there already an account for this number?"
//
// Why this route exists
// ─────────────────────
// The login form used to send the OTP unconditionally and only discover an
// unknown number AFTER verification, as a 428 from /api/customer/auth. Every
// other non-2xx status on that path (503 database timeout, 500, an unparseable
// body) fell through to a thrown Error inside `submitSession`, which surfaced
// as the opaque "Doğrulama başarısız." — so "you have no account yet" was
// indistinguishable from "something broke", and an SMS had already been spent
// either way. Asking first is what makes a real "Kayıt Ol" branch possible.
//
// What this route may and may not disclose
// ────────────────────────────────────────
// It answers with a BOOLEAN AND NOTHING ELSE. No name, no id, no qrUuid, no
// masked phone, no createdAt. An unauthenticated caller must not be able to
// learn anything about a customer beyond the single bit they had to already
// suspect in order to ask. Do not "helpfully" widen this response — the login
// screen has no use for more, and anything more turns a convenience endpoint
// into a directory.
//
// That single bit is still a phone-number enumeration oracle, which is why the
// rate limit below exists. Note that Firebase's own SMS quota used to be the
// (accidental) limiter on this question; now that the check is free, it needs
// its own.
//
// Lives under /api/customer, which src/middleware.ts lists in
// PUBLIC_API_PREFIXES — it must be reachable with no session of any kind, since
// the caller is by definition not logged in yet. It reads no session and
// performs no mutation.

import { NextRequest, NextResponse } from "next/server";

import { lookupCustomerIdByPhone } from "@/lib/customer-lookup";

export const dynamic = "force-dynamic";

/**
 * Best-effort in-memory rate limit.
 *
 * Deliberately modest about what it claims: on Vercel each serverless instance
 * has its own Map, so a determined enumerator spread across instances gets more
 * than WINDOW_MAX attempts. It is not a security boundary — it is a speed bump
 * that makes casual scraping from one client pointless, and it costs nothing.
 * If enumeration ever becomes a real concern the fix is a shared store (Redis /
 * Upstash), not a bigger Map.
 */
const WINDOW_MS = 5 * 60_000;
const WINDOW_MAX = 20;

const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimit(key: string): boolean {
  const now = Date.now();

  // Opportunistic prune so the Map stays bounded by "clients seen in one
  // window" rather than growing for the lifetime of the instance.
  if (attempts.size > 500) {
    for (const [k, v] of attempts) {
      if (v.resetAt <= now) attempts.delete(k);
    }
  }

  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  entry.count += 1;
  return entry.count <= WINDOW_MAX;
}

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(req: NextRequest) {
  if (!rateLimit(clientKey(req))) {
    return NextResponse.json(
      { error: "Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin." },
      { status: 429, headers: { "Cache-Control": "no-store" } }
    );
  }

  let phone: unknown;
  try {
    const body = (await req.json()) as { phone?: unknown };
    phone = body.phone;
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 });
  }

  const result = await lookupCustomerIdByPhone(phone);

  switch (result.status) {
    case "found":
      return NextResponse.json(
        { exists: true },
        { headers: { "Cache-Control": "no-store" } }
      );

    case "not-found":
      return NextResponse.json(
        { exists: false },
        { headers: { "Cache-Control": "no-store" } }
      );

    case "invalid-phone":
      return NextResponse.json(
        {
          error:
            "Geçerli bir telefon numarası girin (örn: 0530 123 45 67 veya 530 123 45 67).",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );

    case "error":
      /*
       * A lookup that could not run is NOT an answer.
       *
       * Returning `{ exists: false }` here would tell a registered customer
       * that their account does not exist and invite them to create a second
       * one — which the UNIQUE phone index would then refuse, stranding them.
       * The client shows a retry instead.
       */
      return NextResponse.json(
        {
          error: result.transient
            ? "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin."
            : "Hesap kontrolü yapılamadı. Lütfen tekrar deneyin.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
  }
}
