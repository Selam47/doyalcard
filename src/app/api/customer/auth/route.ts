// src/app/api/customer/auth/route.ts
// Called after successful Firebase Phone Auth OTP verification.
// Finds or creates the customer record, then sets a session cookie.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setCustomerSession } from "@/lib/customer-session";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone, firebaseUid } = body as {
      phone?: string;
      firebaseUid?: string;
    };

    if (!phone || !firebaseUid) {
      return NextResponse.json(
        { error: "phone and firebaseUid are required" },
        { status: 400 }
      );
    }

    // Normalise: strip spaces from phone number
    const normalised = phone.replace(/\s+/g, "");

    // Find or create the customer
    let isNew = false;
    let customer = await prisma.customer.findUnique({
      where: { phone: normalised },
    });

    if (!customer) {
      isNew = true;
      customer = await prisma.customer.create({
        data: {
          name: "Müşteri",   // placeholder — staff can update via admin panel
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
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
