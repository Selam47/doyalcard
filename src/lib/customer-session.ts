// src/lib/customer-session.ts
// Lightweight HTTP-only cookie session for customers.
// Uses jose (already a next-auth transitive dependency) for JWT signing.
// This is completely separate from the NextAuth staff session.

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

import { CUSTOMER_SESSION_COOKIE } from "@/lib/session-cookie";

const COOKIE_NAME = CUSTOMER_SESSION_COOKIE;

/**
 * JWT'nin kendi son kullanma süresi — cookie'nin DEĞİL.
 *
 * Cookie artık bir *session cookie* (aşağıda `maxAge` yok), yani tarayıcı
 * kapanınca silinir ve `TabSessionGuard` yeni sekmede zaten düşürür. Bu TTL
 * sadece son savunma hattıdır: kopyalanmış bir token'ın sonsuza kadar geçerli
 * kalmasını engeller. Eski 30 günlük değer bu politikayla çelişiyordu.
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
}

/** Sign a JWT and write it as an HTTP-only cookie in a Server Action / Route Handler. */
export async function setCustomerSession(
  customerId: string,
  phone: string
): Promise<void> {
  const token = await new SignJWT({ customerId, phone })
    .setProtectedHeader({ alg: "HS256" })
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

/** Read & verify the session cookie. Returns null if missing or invalid. */
export async function getCustomerSession(): Promise<CustomerSessionPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as CustomerSessionPayload;
  } catch {
    return null;
  }
}

/** Clear the session cookie (for logout). */
export async function clearCustomerSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
}
