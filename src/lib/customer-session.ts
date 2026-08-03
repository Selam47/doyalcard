// src/lib/customer-session.ts
// Lightweight HTTP-only cookie session for customers.
// Uses jose (already a next-auth transitive dependency) for JWT signing.
// This is completely separate from the NextAuth staff session.
//
// ─── Revocation ──────────────────────────────────────────────────────────────
// A signed JWT is stateless: the server can verify it, but deleting the cookie
// only removes the copy THIS browser holds. A token that was copied off a
// shared counter phone, read out of a proxy log or exfiltrated by an XSS
// payload used to stay valid for its full TTL no matter how many times the
// customer pressed "Çıkış Yap" — logout was cosmetic.
//
// Every token therefore carries a `jti`, and logout writes that `jti` to the
// `revoked_customer_sessions` table. `getCustomerSession()` rejects any token
// whose `jti` is listed, so an invalidated session is dead everywhere at once,
// on every device, immediately.
//
// The cost is one indexed primary-key lookup per session read. The revocation
// row only has to outlive the token, so rows past `expiresAt` are pruned on
// every write and the table stays bounded by "logouts within one TTL window".
//
// This module is Node-runtime only (it touches Prisma). It must never be
// imported from middleware — see src/middleware.ts, which stays JWT-only.

import "server-only";

import { randomUUID } from "node:crypto";

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { CUSTOMER_SESSION_COOKIE } from "@/lib/session-cookie";

const COOKIE_NAME = CUSTOMER_SESSION_COOKIE;

/**
 * JWT'nin kendi son kullanma süresi — cookie'nin DEĞİL.
 *
 * Cookie artık bir *session cookie* (aşağıda `maxAge` yok), yani tarayıcı
 * kapanınca silinir ve `TabSessionGuard` yeni sekmede zaten düşürür. Bu TTL
 * sadece son savunma hattıdır: kopyalanmış bir token'ın sonsuza kadar geçerli
 * kalmasını engeller. Eski 30 günlük değer bu politikayla çelişiyordu.
 *
 * Bu süre aynı zamanda bir iptal kaydının yaşaması gereken süredir: `exp`
 * geçtikten sonra token zaten imza doğrulamasında reddedilir.
 */
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export interface CustomerSessionPayload {
  customerId: string;
  phone: string;
  /** Unique id of THIS token, used as the revocation key. */
  jti: string;
}

/** Sign a JWT and write it as an HTTP-only cookie in a Server Action / Route Handler. */
export async function setCustomerSession(
  customerId: string,
  phone: string
): Promise<void> {
  const token = await new SignJWT({ customerId, phone })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
    .sign(getSecret());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // maxAge / expires YOK → session cookie. Tarayıcı kapanınca düşer.
    // Buraya bir maxAge geri eklemek "kalıcı olmayan oturum" garantisini bozar.
    path: "/",
  });
}

/**
 * Is this token id on the revocation list?
 *
 * Fails CLOSED: if the lookup errors we treat the session as revoked rather
 * than waving it through, matching the posture of `staff-guard.ts`. A database
 * outage logging customers out is recoverable; honouring a token we could not
 * check is not.
 */
/**
 * Bu hata "tablo yok" mu?
 *
 * Prisma eksik tabloyu P2021 olarak raporlar; `@prisma/adapter-pg` sürücüsü
 * altında ham PostgreSQL kodu 42P01 olarak da sızabilir. İkisini de yakalıyoruz.
 */
function isMissingTableError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021") return true;
  }

  const code = (error as { code?: unknown })?.code;
  if (code === "42P01" || code === "P2021") return true;

  const message = error instanceof Error ? error.message : String(error);
  return /relation .*revoked_customer_sessions.* does not exist/i.test(message);
}

async function isRevoked(jti: string): Promise<boolean> {
  try {
    const row = await prisma.revokedCustomerSession.findUnique({
      where: { jti },
      select: { jti: true },
    });
    return row !== null;
  } catch (error) {
    /*
     * Bu dal BİR KEZ üretimde tam bir müşteri kesintisine yol açtı ve teşhisi
     * neredeyse imkânsızdı, çünkü tek belirtisi tek satırlık bir sunucu logu ve
     * "OTP doğrulandı ama panele girilemiyor" davranışıydı.
     *
     * Sebep: `RevokedCustomerSession` modeli şemaya eklenip veritabanına HİÇ
     * push edilmemişti. Her sorgu 42P01 ile patlıyordu, fail-closed politikası
     * bunu "iptal edilmiş" sayıyordu ve `getCustomerSession()` GEÇERLİ
     * cookie'ler için bile null dönüyordu. Sonuç: /customer/dashboard ve
     * /card/<uuid> herkesi giriş ekranına geri atıyordu — dolayısıyla müşteri
     * personelin tarayacağı QR kodunu hiç gösteremiyordu.
     *
     * Fail-closed davranışı KORUNUYOR (doğrulayamadığımız bir token'ı geçerli
     * saymak güvenlik gerilemesi olur), ama artık kök sebep loglarda gözden
     * kaçamaz.
     */
    if (isMissingTableError(error)) {
      console.error(
        "[customer-session] FATAL: `revoked_customer_sessions` tablosu " +
          "veritabanında YOK. Her müşteri oturumu fail-closed politikası " +
          "gereği geçersiz sayılıyor — yani HİÇBİR müşteri giriş yapamaz. " +
          "Düzeltme: prisma/sql/2026-08-03_revoked_customer_sessions.sql " +
          "dosyasını çalıştırın (veya `npx prisma db push`).",
        error
      );
      return true;
    }

    console.error("[customer-session] revocation lookup failed:", error);
    return true;
  }
}

/**
 * Read & verify the session cookie. Returns null if missing, invalid, expired
 * or revoked.
 *
 * A token without a `jti` is rejected. Those are tokens minted before
 * revocation existed and there is no way to invalidate them, so they are
 * treated as invalid — the one-off cost is that customers holding a live
 * session at deploy time sign in again.
 */
export async function getCustomerSession(): Promise<CustomerSessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, getSecret());

    const { jti, customerId, phone } = payload as {
      jti?: unknown;
      customerId?: unknown;
      phone?: unknown;
    };

    if (
      typeof jti !== "string" ||
      typeof customerId !== "string" ||
      typeof phone !== "string"
    ) {
      return null;
    }

    if (await isRevoked(jti)) return null;

    return { customerId, phone, jti };
  } catch {
    return null;
  }
}

/**
 * Record a token id as revoked until it would have expired anyway.
 *
 * `upsert` rather than `create`: a double-tapped logout, or a logout racing
 * `/api/session/reset`, must not blow up on the primary key.
 */
async function revokeJti(
  jti: string,
  customerId: string,
  expiresAt: Date
): Promise<void> {
  await prisma.revokedCustomerSession.upsert({
    where: { jti },
    create: { jti, customerId, expiresAt },
    update: {},
  });

  // Opportunistic prune. Runs only on logout, and only deletes rows whose
  // tokens are already dead by `exp`, so it can never revive a session.
  try {
    await prisma.revokedCustomerSession.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
  } catch (error) {
    console.error("[customer-session] revocation prune failed:", error);
  }
}

/**
 * Revoke the caller's current session server-side WITHOUT touching cookies.
 *
 * Split out so `/api/session/reset` — which clears cookies itself, for both the
 * customer and the staff session — can still invalidate the token it is about
 * to throw away.
 *
 * Reads the cookie directly instead of calling `getCustomerSession()`: an
 * already-revoked token would return null there, and we would skip the write
 * that keeps the row alive.
 */
export async function revokeCurrentCustomerSession(): Promise<void> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return;

    const { payload } = await jwtVerify(token, getSecret());
    const jti = typeof payload.jti === "string" ? payload.jti : null;
    const customerId =
      typeof payload.customerId === "string" ? payload.customerId : null;

    // No jti (legacy token) or no exp → nothing revocable, and
    // `getCustomerSession()` already rejects it outright.
    if (!jti || !customerId || typeof payload.exp !== "number") return;

    await revokeJti(jti, customerId, new Date(payload.exp * 1000));
  } catch (error) {
    // An unverifiable/expired token needs no revocation.
    console.error("[customer-session] revoke failed:", error);
  }
}

/**
 * Log out: revoke the token server-side, THEN clear the cookie.
 *
 * Order matters. Clearing first would lose the only copy of the `jti` we have
 * and leave the token valid — which is precisely the bug this replaces.
 */
export async function clearCustomerSession(): Promise<void> {
  await revokeCurrentCustomerSession();

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
}
