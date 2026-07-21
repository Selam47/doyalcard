# Ekrem Coşkun Döner — Dijital Sadakat Kartı Sistemi

QR kodlu dijital pul kartı sistemi. Her etli ekmek siparişinde müşteri pul kazanır; belirli eşiklerde otomatik ödül verilir.

## Tech Stack

| Katman | Teknoloji |
|---|---|
| Framework | Next.js 16 (App Router) |
| Veritabanı | PostgreSQL (Neon.tech) |
| ORM | Prisma 7 |
| Auth | NextAuth v5 (Auth.js) + Credentials |
| UI | shadcn/ui + Tailwind CSS v4 |
| Toast | Sonner |
| QR Üretim | qrcode npm |
| QR Okuma | html5-qrcode |

## Ortam Değişkenleri

`.env.local` dosyasını `.env.example`'dan kopyalayın:

```bash
cp .env.example .env.local
```

`.env.local` içeriği:

```env
# Neon.tech veritabanı (pooled bağlantı)
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"

# Neon.tech veritabanı (doğrudan — migration için)
DIRECT_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require"

# NextAuth v5 gizli anahtarı (openssl rand -base64 32 ile üretin)
AUTH_SECRET="your-secret-key"

# QR kod URL'si için base URL
NEXT_PUBLIC_BASE_URL="http://localhost:3000"
```

> **Not:** Prisma CLI araçları (db push, seed) `.env` dosyasını okur; Next.js ise `.env.local` kullanır.
> Her iki dosyayı da doldurun veya yalnızca `.env` kullanın.

## Kurulum

```bash
# 1. Bağımlılıkları yükle
npm install

# 2. Prisma client oluştur
npm run db:generate

# 3. Veritabanı şemasını gönder (Neon.tech)
npm run db:push

# 4. Örnek verileri yükle
npm run db:seed

# 5. Geliştirme sunucusunu başlat
npm run dev
```

## Veritabanı Komutları

```bash
npm run db:generate   # Prisma client'ı yeniden oluştur
npm run db:push       # Schema'yı DB'ye gönder (migration olmadan)
npm run db:seed       # Örnek verileri yükle
npm run db:studio     # Prisma Studio'yu aç
```

## Giriş Bilgileri (Seed)

| Rol | Email | Şifre |
|---|---|---|
| Admin | admin@ekremdoner.com | Admin1234! |
| Personel | personel@ekremdoner.com | Staff1234! |

## Test Müşterileri (Seed)

| Müşteri | Telefon | QR URL |
|---|---|---|
| Ali Yılmaz | +905551234567 | /card/aaaaaaaa-0000-0000-0000-000000000001 |
| Fatma Kaya | +905559876543 | /card/bbbbbbbb-0000-0000-0000-000000000002 |

## Uygulama URL'leri

| URL | Açıklama |
|---|---|
| `/login` | Personel / Admin giriş sayfası |
| `/staff` | QR tarama ve telefon arama |
| `/staff/register` | Yeni müşteri kayıt formu |
| `/admin` | Yönetim paneli (dashboard) |
| `/admin/rules` | Kampanya kuralları CRUD |
| `/admin/branches` | Şube yönetimi |
| `/admin/staff` | Personel yönetimi |
| `/card/[uuid]` | Müşteri sadakat kartı (herkese açık) |

## Kampanya Mantığı

1. Personel müşterinin QR kodunu tarar veya telefon ile arar
2. `/card/[uuid]` sayfasında **+1 Etli Ekmek Siparişi** butonuna basar
3. Sistem `current_cycle_count`'u artırır
4. `campaign_rules` tablosundan eşleşen kural kontrol edilir:
   - `threshold == 5` → 1 Ücretsiz Ayran (PENDING)
   - `threshold == 7` → 1 Ücretsiz Sütlaç (PENDING)
   - `threshold == 11` → 3 Kişilik Etli Ekmek (PENDING, sonra sıfırlama)
5. Personel ödülü **Kullandır** butonuyla CLAIMED'e çeker

## Güvenlik

- Tüm Server Actions `auth()` ile session kontrolü yapar
- Middleware `/staff` ve `/admin` rotalarını korur
- Bcrypt (cost factor 12) ile şifre hashleme
- KVKK onayı müşteri kaydında zorunludur

## Production Deployment

```bash
# Vercel (önerilen)
npx vercel

# Manuel
npm run build
npm start
```

`NEXT_PUBLIC_BASE_URL`'yi production domain'inizle güncelleyin.
