// src/app/api/customer/auth/route.ts
// Called after successful Firebase Phone Auth OTP verification.
// The client sends its Firebase ID TOKEN — never a bare phone/uid pair.
// The token's RS256 signature is verified against Google's public JWKS and
// the phone number is read from the verified claims, so a caller can only
// ever obtain a session for the phone number Firebase actually verified.
// Runs on the standard Node.js serverless runtime (Vercel default) so it can
// use the `pg`-backed Prisma client in src/lib/prisma.ts.

import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

import { prisma } from "@/lib/prisma";
import {
  revokeCurrentCustomerSession,
  setCustomerSession,
} from "@/lib/customer-session";
import { isValidE164, normalizePhoneToE164 } from "@/lib/phone";
import { isDbConnectionError } from "@/lib/db-errors";

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

/**
 * HTTP 428 Precondition Required — "verified, but I will not create your
 * record until you have consented." Deliberately not 400/403: the client has
 * to be able to tell "show the KVKK consent screen and retry" apart from a
 * real failure.
 */
const CONSENT_REQUIRED_STATUS = 428;

const CONSENT_REQUIRED_MESSAGE =
  "Hesabınızın oluşturulabilmesi için KVKK aydınlatma metnini onaylamanız gerekir.";

export async function POST(req: NextRequest) {
  let idToken: string | undefined;
  /**
   * Consent must be the literal `true`. Anything else — absent, "true", 1,
   * null — is NOT consent. KVKK requires an explicit affirmative act, so a
   * truthy coercion here would be the same defect this fix exists to remove.
   */
  let kvkkConsent = false;

  try {
    const body = (await req.json()) as {
      idToken?: string;
      kvkkConsent?: unknown;
    };
    idToken = body.idToken;
    kvkkConsent = body.kvkkConsent === true;
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 });
  }

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json({ error: "idToken is required" }, { status: 400 });
  }

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) {
    console.error("[customer/auth] NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  let phoneClaim: string;
  try {
    const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
      algorithms: ["RS256"],
    });
    phoneClaim = typeof payload.phone_number === "string" ? payload.phone_number : "";
  } catch (err) {
    console.error("[customer/auth] ID token verification failed:", err);
    return NextResponse.json(
      { error: "Kimlik doğrulama başarısız. Lütfen tekrar giriş yapın." },
      { status: 401 }
    );
  }

  const normalised = normalizePhoneToE164(phoneClaim) ?? "";
  if (!isValidE164(normalised)) {
    return NextResponse.json(
      { error: "Doğrulanan hesapta geçerli bir telefon numarası bulunamadı." },
      { status: 401 }
    );
  }

  try {
    let isNew = false;
    let customer = await prisma.customer.findUnique({
      where: { phone: normalised },
      select: { id: true, phone: true, kvkkConsent: true },
    });

    /*
     * Consent gate.
     *
     * Previously this route created the row with `kvkkConsent: false` and
     * handed out a session regardless — so a customer record (name, phone,
     * and from then on an order and reward history) came into existence
     * without the person ever agreeing to anything, while the staff-side
     * `registerCustomer` action required an explicit tick. KVKK does not care
     * which door the record came through.
     *
     * The gate covers two cases:
     *   • no row yet  → nothing is created until consent arrives;
     *   • a row that still carries `kvkkConsent: false` (created by the old
     *     code path) → no session until consent is given and recorded.
     *
     * In both cases the response carries `requiresConsent` so the client can
     * show the consent screen and retry with the SAME verified id token. The
     * Firebase token has already been verified at this point, so the retry
     * costs no extra SMS.
     */
    if (!customer || !customer.kvkkConsent) {
      if (!kvkkConsent) {
        return NextResponse.json(
          {
            error: CONSENT_REQUIRED_MESSAGE,
            requiresConsent: true,
            isNew: !customer,
          },
          { status: CONSENT_REQUIRED_STATUS }
        );
      }

      const consentedAt = new Date();
      isNew = customer === null;

      // upsert, not create-or-update: `phone` is UNIQUE, and two taps of the
      // consent button (or a retried request) would otherwise race into a
      // P2002. The create branch records the consent that just authorised the
      // row; the update branch backfills a row left unconsented by the old
      // code path.
      customer = await prisma.customer.upsert({
        where: { phone: normalised },
        create: {
          name: "Müşteri",
          phone: normalised,
          kvkkConsent: true,
          kvkkConsentAt: consentedAt,
        },
        update: { kvkkConsent: true, kvkkConsentAt: consentedAt },
        select: { id: true, phone: true, kvkkConsent: true },
      });
    }

    /*
     * Kill whatever session this browser was already carrying BEFORE minting
     * the new one.
     *
     * A verified OTP is the strongest identity signal the system has, so the
     * person who just proved they own this number must end up as the ONLY
     * identity attached to this browser. Without this, the previous occupant's
     * token stayed live: on a shared counter phone (or the owner's own device
     * used to test several numbers) it remained a valid credential that could
     * still be replayed, and any copy of it kept working for its full TTL.
     *
     * Revoking is deliberately best-effort — a failure here must not cost the
     * customer the login they just completed, and `setCustomerSession` below
     * overwrites the cookie regardless.
     */
    try {
      await revokeCurrentCustomerSession();
    } catch (error) {
      console.error("[customer/auth] previous session revoke failed:", error);
    }

    await setCustomerSession(customer.id, customer.phone);

    return NextResponse.json({ ok: true, isNew });
  } catch (err) {
    console.error("[customer/auth]", err);

    if (isDbConnectionError(err)) {
      return NextResponse.json(
        { error: "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
