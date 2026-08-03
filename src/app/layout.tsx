import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { TabSessionGuard } from "@/components/auth/TabSessionGuard";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    template: "%s | Doyalcard",
    default: "Doyalcard",
  },
  description:
    "Ekrem Coşkun Döner dijital sadakat kartı sistemi. Her etli ekmek siparişinizde puan kazanın, ödüller toplayın!",
  keywords: [
    "ekrem coşkun döner",
    "doyalcard",
    "sadakat kartı",
    "dijital kart",
    "etli ekmek",
    "konya",
    "ödül sistemi",
  ],
  authors: [{ name: "Ekrem Coşkun Döner" }],
  creator: "Ekrem Coşkun Döner",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Doyalcard",
  },
  openGraph: {
    type: "website",
    locale: "tr_TR",
    title: "Ekrem Coşkun Döner — Sadakat Kartı",
    description: "Her etli ekmek siparişinizde puan kazanın, ödüller toplayın!",
    siteName: "Ekrem Coşkun Döner",
  },
};

export const viewport: Viewport = {
  themeColor: "#0B2B1B",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <head>
        {/*
          Manifest isteği aynı origin'den yapılsa bile tarayıcı varsayılan olarak
          "no-cors" modunda ve cookie göndermeden ister. Vercel'de deployment
          protection veya auth middleware devredeyse bu istek 401/302'ye takılır
          ve PWA kurulamaz. `use-credentials` cookie'lerin gönderilmesini sağlar.
        */}
        <link
          rel="manifest"
          href="/manifest.webmanifest"
          crossOrigin="use-credentials"
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        {/*
          Kök layout'ta duruyor ki sekme kontrolü sekme başına TEK sefer çalışsın
          (client-side gezinmelerde bu ağaç yeniden mount edilmez). Korumalı
          yolları kendi içinde tanır ve sadece onlarda içeriği bekletir.
        */}
        <TabSessionGuard>
          <div className="relative min-h-screen flex flex-col">
            {children}
          </div>
        </TabSessionGuard>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
