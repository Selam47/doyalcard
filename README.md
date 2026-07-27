Set-Content -Path README.md -Value '# 💳 Doyalcard — QR Kodlu Dijital Sadakat Kartı & Kampanya Yönetim Sistemi

**Doyalcard**, restoran ve işletmeler için geliştirilmiş; kağıt kart kullanımını ortadan kaldıran, QR kod tabanlı, full-stack bir **Dijital Sadakat ve Ödül Yönetimi Platformudur**.

Müşteriler her siparişlerinde dijital pul kazanır, belirlenen eşik değerlere (örn. 15 pul) ulaştıklarında sistem otomatik olarak hediyeleri tanımlar ve yeni döngüyü başlatır.

---

## 🚀 Öne Çıkan Özellikler

- 📱 **QR Kod Tabanlı Müşteri Kartı:** Müşteriye özel benzersiz (UUID) dinamik QR kod yapısı.
- ⚡ **Hızlı Sipariş / Pul İşleme:** Personel paneli üzerinden kamerayla QR tarama veya telefon numarasıyla saniyeler içinde pul ekleme.
- 🎯 **Dinamik Kampanya Motoru:** Admin panelinden tamamen özelleştirilebilir eşik değerleri (Threshold) ve ödül kuralları.
- 🔒 **Sıkı Güvenlik ve Yetkilendirme:** NextAuth v5 ile Role-Based Access Control (RBAC) mimarisi.
- 📊 **Yönetim Paneli (Dashboard):** Şube, personel, müşteri ve aktif kampanya istatistiklerinin takibi.
- 🛡️ **KVKK Uyumlu Müşteri Kaydı:** Müşteri kayıt süreçlerinde entegre onay mekanizması.

---

## 🛠️ Teknoloji Yığını (Tech Stack)

| Katman | Teknoloji | Açıklama |
|---|---|---|
| **Framework** | Next.js 16 (App Router) | React Server Components & Server Actions |
| **Dil** | TypeScript | Type-safe uçtan uca geliştirme |
| **Veritabanı** | PostgreSQL (Neon.tech) | Serverless & Cloud Database |
| **ORM** | Prisma 7 | Schema yönetimi ve type-safe sorgular |
| **Kimlik Doğrulama** | NextAuth v5 (Auth.js) | Session bazlı, Bcrypt hash''li yetkilendirme |
| **Stil / UI** | Tailwind CSS v4 + shadcn/ui | Modern, responsive ve erişilebilir arayüz |
| **Bildirimler** | Sonner | Real-time toast bildirimleri |
| **QR Araçları** | `qrcode` & `html5-qrcode` | QR oluşturma ve cihaz kamerasından tarama |

---

## 🛡️ Güvenlik Mimarisi

- **Sıfır Sızıntı (Zero-Leakage):** Veritabanı kimlik bilgileri, JWT secret ve API anahtarları `.env` yapılandırması altında tutulur ve `.gitignore` kuralı ile sürüm kontrolü dışında bırakılır.
- **Güvenli Sunucu Eylemleri (Server Actions):** Tüm veri güncelleme ve pul ekleme fonksiyonları arka planda `auth()` oturum kontrolünden ve rol doğrulamasından geçer.
- **Middleware Koruması:** `/admin` ve `/staff` gibi kritik rotalar yetkisiz erişimlere karşı middleware katmanında engellenir.
- **Parola Güvenliği:** Personel ve yönetici şifreleri veritabanında **Bcrypt (Cost Factor: 12)** algoritması ile şifrelenerek saklanır.

---

## 📁 Proje Dizin Yapısı

```text
doyalcard/
├── app/                  # Next.js App Router sayfaları ve Server Actions
│   ├── (auth)/           # Login ve yetkilendirme sayfaları
│   ├── admin/            # Yönetici paneli (Kurallar, Şubeler, Personel)
│   ├── staff/            # Personel QR tarama ve müşteri arama paneli
│   └── card/[uuid]/      # Müşteriye özel dijital kart görünümü (Public)
├── components/           # UI ve Reusable React bileşenleri
├── lib/                  # Prisma Client, auth konfigürasyonu ve yardımcı araçlar
├── prisma/               # Schema dosyası ve seed verileri
└── public/               # Statik görseller ve varlıklar
