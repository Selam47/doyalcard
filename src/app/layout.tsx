import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

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
  // app/manifest.ts is served automatically by Next.js at /manifest.webmanifest
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon-32x32.png",
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
      <body className={`${inter.variable} font-sans antialiased`}>
        <div className="relative min-h-screen flex flex-col">
          {children}
        </div>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
