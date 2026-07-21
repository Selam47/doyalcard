import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    template: "%s | Ekrem Coşkun Döner",
    default: "Ekrem Coşkun Döner — Sadakat Kartı",
  },
  description:
    "Ekrem Coşkun Döner dijital sadakat kartı sistemi. Her etli ekmek siparişinizde puan kazanın, ödüller toplayın!",
  keywords: [
    "ekrem coşkun döner",
    "sadakat kartı",
    "dijital kart",
    "etli ekmek",
    "konya",
    "ödül sistemi",
  ],
  authors: [{ name: "Ekrem Coşkun Döner" }],
  creator: "Ekrem Coşkun Döner",
  openGraph: {
    type: "website",
    locale: "tr_TR",
    title: "Ekrem Coşkun Döner — Sadakat Kartı",
    description: "Her etli ekmek siparişinizde puan kazanın, ödüller toplayın!",
    siteName: "Ekrem Coşkun Döner",
  },
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
