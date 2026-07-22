import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";


export default async function HomePage() {
  const session = await auth();

  // ─── Redirect Authenticated Users ─────────────────────────────────────────
  if (session?.user?.role === "ADMIN") {
    redirect("/admin");
  }
  if (session?.user?.role === "STAFF") {
    redirect("/staff");
  }

  // ─── Landing Page for Unauthenticated Users ───────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-green-50">
      {/* Hero Section */}
      <div className="container mx-auto px-4 py-16 md:py-24">
        <div className="flex flex-col items-center text-center space-y-8 max-w-3xl mx-auto">
          {/* Logo/Brand */}
          <div className="space-y-2">
            <h1 className="text-4xl md:text-6xl font-bold text-gray-900 tracking-tight">
              Ekrem Coşkun Döner
            </h1>
            <p className="text-xl md:text-2xl text-green-600 font-medium">
              Dijital Sadakat Kartı Sistemi
            </p>
          </div>

          {/* Value Proposition */}
          <p className="text-lg md:text-xl text-gray-600 leading-relaxed">
            Her etli ekmek siparişinizde puan toplayın, özel ödüller kazanın!
            Kartınız her zaman cebinizde, uygulama indirmeye gerek yok.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <Link
              href="/customer/login"
              className="inline-flex items-center justify-center rounded-lg bg-green-600 px-6 py-3 text-lg font-semibold text-white transition hover:bg-green-700"
            >
              🫓 Müşteri Girişi
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-lg border border-green-300 px-6 py-3 text-lg font-semibold text-green-700 transition hover:bg-green-50"
            >
              Personel Girişi
            </Link>
          </div>
        </div>

        {/* Features Section */}
        <div className="grid md:grid-cols-3 gap-6 mt-20">
          <Card className="border-green-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-700">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M12 4v16m8-8H4" />
                </svg>
                Kolay Puan Toplama
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-base">
                Her etli ekmek siparişinizde otomatik olarak puan kazanırsınız. 
                11 siparişte büyük ödülü hak ediyorsunuz!
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-green-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-700">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Güvenli & Dijital
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-base">
                QR kodunuz size özel. Kartınızı kaybetme riski yok, 
                puanlarınız güvende.
              </CardDescription>
            </CardContent>
          </Card>

          <Card className="border-green-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-700">
                <svg
                  className="w-6 h-6"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                Özel Ödüller
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-base">
                5 siparişte ücretsiz ayran, 7 siparişte sütlaç, 
                11 siparişte 3 kişilik etli ekmek kazanın!
              </CardDescription>
            </CardContent>
          </Card>
        </div>

        {/* How It Works */}
        <div className="mt-20 max-w-2xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-10">
            Nasıl Çalışır?
          </h2>
          <div className="space-y-6">
            <div className="flex gap-4 items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                1
              </div>
              <div>
                <h3 className="font-semibold text-lg text-gray-900">
                  Kayıt Olun
                </h3>
                <p className="text-gray-600">
                  İlk siparişinizde personelimiz sizin için kayıt oluşturur ve 
                  QR kodunuzu verir.
                </p>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                2
              </div>
              <div>
                <h3 className="font-semibold text-lg text-gray-900">
                  Puan Toplayın
                </h3>
                <p className="text-gray-600">
                  Her etli ekmek siparişinizde QR kodunuzu gösterin, 
                  puanınız otomatik olarak yüklensin.
                </p>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center font-bold">
                3
              </div>
              <div>
                <h3 className="font-semibold text-lg text-gray-900">
                  Ödülleri Kullanın
                </h3>
                <p className="text-gray-600">
                  Belirli puanlarda otomatik olarak ödül kazanırsınız. 
                  Ödüllerinizi bir sonraki ziyaretinizde kullanabilirsiniz.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-20 text-center text-gray-500 text-sm">
          <p>© 2026 Ekrem Coşkun Döner. Tüm hakları saklıdır.</p>
          <p className="mt-2">
            Müşteri girişi için{" "}
            <Link href="/customer/login" className="text-green-600 hover:underline">
              buraya tıklayın
            </Link>
            {" · "}
            <Link href="/login" className="text-gray-400 hover:underline">
              Personel Girişi
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
