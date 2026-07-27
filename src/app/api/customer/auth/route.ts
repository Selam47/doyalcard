// src/app/api/customer/auth/route.ts
// Called after successful Firebase Phone Auth OTP verification.
// Finds or creates the customer record, then sets a session cookie.
// Runs on the standard Node.js serverless runtime (Vercel default) so it can
// use the `pg`-backed Prisma client in src/lib/prisma.ts.

import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { setCustomerSession } from "@/lib/customer-session";
import { isValidE164, sanitizePhoneInput } from "@/lib/phone";
import { isDbConnectionError } from "@/lib/db-errors";

export async function POST(req: NextRequest) {
  let phone: string | undefined;
  let firebaseUid: string | undefined;

  try {
    const body = await req.json();
    ({ phone, firebaseUid } = body as { phone?: string; firebaseUid?: string });
  } catch {
    return NextResponse.json({ error: "Geçersiz istek gövdesi" }, { status: 400 });
  }

  if (!phone || !firebaseUid) {
    return NextResponse.json(
      { error: "phone and firebaseUid are required" },
      { status: 400 }
    );
  }

  // Enforce strict E.164 — every phone number in the database must be in
  // this canonical form so Firebase Auth, the staff/admin panels, and the
  // customer dashboard all agree on the same identity for a given number.
  const normalised = sanitizePhoneInput(phone);
  if (!isValidE164(normalised)) {
    return NextResponse.json(
      { error: "Telefon numarası geçerli bir E.164 formatında olmalı (+90...)" },
      { status: 400 }
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
