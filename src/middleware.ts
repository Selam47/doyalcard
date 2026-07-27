import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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

const PUBLIC_ASSET_PATTERN = /\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|webmanifest|json|txt|xml|woff2?|ttf|otf)$/i;

export function isPublicAsset(pathname: string): boolean {
  return PUBLIC_FILES.has(pathname) || PUBLIC_ASSET_PATTERN.test(pathname);
}

export function middleware(request: NextRequest) {
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

  // Şu an uygulama genelinde middleware seviyesinde auth kontrolü yok;
  // oturum doğrulaması server component / route handler katmanında yapılıyor.
  return NextResponse.next();
}

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
