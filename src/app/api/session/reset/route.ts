// src/app/api/session/reset/route.ts
//
// Yeni bir sekme açıldığında TabSessionGuard tarafından çağrılır ve mevcut
// oturum cookie'lerini düşürür. Kimlik doğrulaması YOKTUR ve olmamalıdır:
// tek yaptığı şey çağıranın KENDİ cookie'lerini silmek. Bir saldırgan bunu
// tetikleyerek en fazla kurbanı logout edebilir; oturum çalamaz, veri okuyamaz.
//
// Yine de GET değil POST: tarayıcı ön-getirmeleri (prefetch/link tarama)
// kullanıcıyı kazara logout etmesin.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { isSessionScopedCookie } from "@/lib/session-cookie";

export const dynamic = "force-dynamic";

export async function POST() {
  const cookieStore = await cookies();

  for (const cookie of cookieStore.getAll()) {
    if (!isSessionScopedCookie(cookie.name)) continue;

    cookieStore.set(cookie.name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }

  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}
