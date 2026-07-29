import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { authConfig } from "@/lib/auth.config";

// Edge-safe NextAuth instance: authConfig carries NO provider, NO adapter and
// NO Prisma/bcrypt import, so this module bundles cleanly for the Edge runtime.
// `req.auth` below is the Session object produced by the shared session
// callback, which is why `role` is available here.
const { auth } = NextAuth(authConfig);

/**
 * PWA / statik varlıklar için her zaman serbest bırakılacak yollar.
 * Buraya ileride auth kontrolü eklense bile bu liste asla korunmamalı;
 * aksi halde manifest ve ikonlar 401/302'ye takılır ve PWA kurulamaz.
 */
const PUBLIC_FILES = new Set<string>([
  "/manifest.webmanifest",
  "/manifest.json",
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/robots.txt",
  "/sitemap.xml",
  "/sw.js",
]);

const PUBLIC_ASSET_PATTERN =
  /\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|webmanifest|json|txt|xml|woff2?|ttf|otf)$/i;

export function isPublicAsset(pathname: string): boolean {
  return PUBLIC_FILES.has(pathname) || PUBLIC_ASSET_PATTERN.test(pathname);
}

// ─── Route policy ─────────────────────────────────────────────────────────────
// This is a DEFENCE-IN-DEPTH layer, not the only check. Every Server Action and
// route handler still re-reads the session itself, because a Server Action is a
// publicly callable endpoint reachable by its action id — middleware alone
// cannot protect it. The point of this layer is that a NEW page or API route
// added under these prefixes is protected by default, instead of shipping open
// until someone remembers to add a guard.

/** ADMIN role required. */
const ADMIN_PREFIXES = ["/admin", "/api/admin"] as const;

/** STAFF or ADMIN role required. */
const STAFF_PREFIXES = ["/staff", "/api/staff", "/api/pos", "/api/cashier"] as const;

/**
 * API routes that must stay reachable without a NextAuth staff session.
 *
 *  • /api/auth      — NextAuth's own sign-in/sign-out/session endpoints.
 *  • /api/customer  — the customer portal. These run on the SEPARATE customer
 *                     cookie session (src/lib/customer-session.ts) and each
 *                     handler verifies it itself. A customer session is not a
 *                     staff session and can never satisfy the checks below.
 *
 * Everything else under /api is staff-gated by default — see apiRequiresStaff().
 */
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/customer"] as const;

/** Segment-aware prefix match: "/admin" matches "/admin/x" but not "/administrator". */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function matchesAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => isUnder(pathname, prefix));
}

/**
 * Fail-closed default for the API surface: anything under /api that is not
 * explicitly listed as public requires a staff session. Adding a new public
 * endpoint therefore has to be a deliberate edit to PUBLIC_API_PREFIXES.
 */
function apiRequiresStaff(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") && !matchesAny(pathname, PUBLIC_API_PREFIXES)
  );
}

// ─── Denial helpers ───────────────────────────────────────────────────────────

/** API callers get JSON; page navigations get a redirect they can recover from. */
function denyUnauthenticated(request: NextRequest, isApi: boolean) {
  if (isApi) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const loginUrl = new URL("/login", request.nextUrl);
  // Preserve where they were headed so login can bounce them back.
  loginUrl.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`
  );
  return NextResponse.redirect(loginUrl);
}

/**
 * Authenticated, but the role is wrong. 403 (not 401) for APIs — re-authenticating
 * as the same user would not help. Pages go to the highest surface the user IS
 * allowed to see, matching what the /admin and /staff layouts already do.
 */
function denyForbidden(request: NextRequest, isApi: boolean, fallback: string) {
  if (isApi) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.redirect(new URL(fallback, request.nextUrl));
}

export default auth(function middleware(request) {
  const { pathname } = request.nextUrl;

  // Statik/public varlıklar: hiçbir auth veya güvenlik kontrolüne sokulmaz.
  if (isPublicAsset(pathname)) {
    const response = NextResponse.next();
    // Manifest `crossOrigin="use-credentials"` ile isteniyor; kimlik bilgili
    // isteklerde tarayıcı ACAO olarak wildcard kabul etmez, bu yüzden isteğin
    // kendi origin'ini yansıtıyoruz.
    const origin = request.headers.get("origin");
    if (origin) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Credentials", "true");
      response.headers.set("Vary", "Origin");
    }
    return response;
  }

  const session = request.auth;
  const role = session?.user?.role;
  const isApi = pathname.startsWith("/api/");

  // ── ADMIN-only ────────────────────────────────────────────────────────────
  if (matchesAny(pathname, ADMIN_PREFIXES)) {
    if (!session?.user) return denyUnauthenticated(request, isApi);
    // A STAFF user is authenticated but not entitled — send them to /staff,
    // the same fallback src/app/admin/layout.tsx uses.
    if (role !== "ADMIN") return denyForbidden(request, isApi, "/staff");
    return NextResponse.next();
  }

  // ── STAFF or ADMIN ────────────────────────────────────────────────────────
  if (matchesAny(pathname, STAFF_PREFIXES) || apiRequiresStaff(pathname)) {
    if (!session?.user) return denyUnauthenticated(request, isApi);
    if (role !== "STAFF" && role !== "ADMIN") {
      return denyForbidden(request, isApi, "/");
    }
    return NextResponse.next();
  }

  // Everything else (/, /login, /customer/*, /card/*) is intentionally open and
  // guarded by its own page/handler logic.
  return NextResponse.next();
});

export const config = {
  matcher: [
    /*
     * Aşağıdakiler HARİÇ tüm yollarda çalışır:
     * - _next/static, _next/image (build çıktıları)
     * - manifest.webmanifest, favicon.ico ve diğer public ikon/görseller
     * - uzantılı tüm statik dosyalar
     */
    "/((?!_next/static|_next/image|manifest\\.webmanifest|manifest\\.json|favicon\\.ico|robots\\.txt|sitemap\\.xml|sw\\.js|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf|otf)$).*)",
  ],
};
