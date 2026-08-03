// src/app/api/session/reset/route.ts
//
// Yeni bir sekme açıldığında TabSessionGuard tarafından çağrılır ve mevcut
// oturum cookie'lerini düşürür. Kimlik doğrulaması YOKTUR ve olmamalıdır:
// tek yaptığı şey çağıranın KENDİ cookie'lerini silmek. Bir saldırgan bunu
// tetikleyerek en fazla kurbanı logout edebilir; oturum çalamaz, veri okuyamaz.
//
// Yine de GET değil POST: tarayıcı ön-getirmeleri (prefetch/link tarama)
// kullanıcıyı kazara logout etmesin.
//
// ─── `scope` NEDEN VAR ───────────────────────────────────────────────────────
// Bu uç nokta eskiden KOŞULSUZ olarak hem müşteri hem personel cookie'sini
// siliyordu. Ham bir kamera taraması /card/<uuid> adresini HER ZAMAN yeni bir
// sekmede açtığı için, kasadaki personel müşterinin QR'ını telefon kamerasıyla
// okuttuğunda TabSessionGuard tetikleniyor ve NextAuth personel cookie'si de
// sessizce siliniyordu — yani kasiyer vardiya ortasında oturumdan düşüyordu.
//
// Artık çağıran, sekmenin indiği sayfanın SAHİBİ olan oturum sınıfını
// bildiriyor: /card ve /customer/* → "customer", /staff ve /admin → "staff",
// nötr sayfalar (/, /login, /customer/login) → "all".
//
// Güvenlik açısından bir gerileme değil: `scope` yalnızca çağıranın KENDİ
// cookie'lerinin ne kadarının silineceğini daraltır, hiçbir şeye erişim açmaz.
// Cookie'ler hâlâ `Expires` taşımayan session cookie'leridir, yani tarayıcı
// tamamen kapandığında zaten düşerler.

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";

import {
  isSessionScopedCookie,
  parseSessionScope,
  type SessionScope,
} from "@/lib/session-cookie";
import { revokeCurrentCustomerSession } from "@/lib/customer-session";

export const dynamic = "force-dynamic";

async function readScope(req: NextRequest): Promise<SessionScope> {
  // Gövde boş/bozuk olabilir (eski istemciler, keepalive istekleri). O durumda
  // eski davranışa — her şeyi sil — geri düşüyoruz: fail-safe olan bu.
  try {
    const body = (await req.json()) as { scope?: unknown };
    return parseSessionScope(body?.scope);
  } catch {
    return "all";
  }
}

export async function POST(req: NextRequest) {
  const scope = await readScope(req);

  // Revoke BEFORE the cookies are dropped — once the cookie is gone the token's
  // `jti` is unrecoverable and the token would stay valid for anyone holding a
  // copy. Same ordering requirement as clearCustomerSession().
  //
  // Sadece müşteri cookie'si gerçekten silinecekse iptal kaydı yazıyoruz;
  // aksi halde "staff" scope'unda hayatta bırakılan bir müşteri token'ını
  // iptal listesine yazıp kendi kendimize geçersiz kılardık.
  if (scope !== "staff") {
    await revokeCurrentCustomerSession();
  }

  const cookieStore = await cookies();

  for (const cookie of cookieStore.getAll()) {
    if (!isSessionScopedCookie(cookie.name, scope)) continue;

    cookieStore.set(cookie.name, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }

  return NextResponse.json(
    { ok: true, scope },
    { headers: { "Cache-Control": "no-store" } }
  );
}
