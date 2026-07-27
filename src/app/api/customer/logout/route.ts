// src/app/api/customer/logout/route.ts
// Clears the customer session cookie.

import { NextResponse } from "next/server";

import { clearCustomerSession } from "@/lib/customer-session";

export async function POST() {
  await clearCustomerSession();
  return NextResponse.json({ ok: true });
}
