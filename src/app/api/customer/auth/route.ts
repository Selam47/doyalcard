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
import { setCustomerSession } from "@/lib/customer-session";
import { isValidE164, sanitizePhoneInput } from "@/lib/phone";
import { isDbConnectionError } from "@/lib/db-errors";

// Google's public signing keys for Firebase ID tokens. Module-level so the
// key set (and jose's internal cache of it) survives across invocations of
// a warm serverless function.
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
  )
);

export async function POST(req: NextRequest) {
  let idToken: string | undefined;

  try {
    const body = (await req.json()) as { idToken?: string };
    idToken = body.idToken;
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

  // ── Verify the Firebase ID token (signature + issuer + audience) ──────────
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

  // Firebase already emits E.164, but normalise defensively so the database
  // key can never drift from the canonical form the rest of the app uses.
  const normalised = sanitizePhoneInput(phoneClaim);
  if (!isValidE164(normalised)) {
    return NextResponse.json(
      { error: "Doğrulanan hesapta geçerli bir telefon numarası bulunamadı." },
      { status: 401 }
    );
  }

  try {
    // Find or create the customer
    let isNew = false;
    let customer = await prisma.customer.findUnique({
      where: { phone: normalised },
    });

    if (!customer) {
      isNew = true;
      customer = await prisma.customer.create({
        data: {
          name: "Müşteri", // placeholder — staff can update via admin panel
          phone: normalised,
          kvkkConsent: false,
        },
      });
    }

    // Set the HTTP-only session cookie
    await setCustomerSession(customer.id, customer.phone);

    return NextResponse.json({ ok: true, isNew });
  } catch (err) {
    console.error("[customer/auth]", err);

    // Neon compute can be scaled to zero between requests; the first query
    // after an idle period pays a "cold start" reconnect cost and can time
    // out. Surface that distinctly so the client can retry instead of
    // treating it as a hard failure.
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
