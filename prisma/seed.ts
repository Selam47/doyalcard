import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { Pool } from "pg";
import { PrismaClient, Role } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const projectRoot = path.resolve(__dirname, "..");
const envFiles = [".env.local", ".env"];
const loadedEnvFiles: string[] = [];

for (const file of envFiles) {
  const fullPath = path.join(projectRoot, file);
  if (!fs.existsSync(fullPath)) continue;
  const result = dotenv.config({ path: fullPath });
  if (result.error) {
    console.error(`⚠️  ${file} okunamadı:`, result.error);
    continue;
  }
  loadedEnvFiles.push(file);
}

/** Prints a readable diagnostic block and exits with code 1. */
function fail(title: string, details: string[], error?: unknown): never {
  console.error(`\n❌ ${title}\n`);
  for (const line of details) console.error(`   ${line}`);
  if (error) {
    console.error("\n──────── Ham hata ────────");
    console.error(error);
    if (error instanceof Error && error.stack) {
      console.error("\n──────── Stack trace ────────");
      console.error(error.stack);
    }
    const cause = (error as { cause?: unknown })?.cause;
    if (cause) {
      console.error("\n──────── cause ────────");
      console.error(cause);
    }
  }
  console.error("");
  process.exit(1);
}

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const usingFallback = !process.env.DIRECT_URL && !!process.env.DATABASE_URL;

if (!connectionString) {
  fail("Veritabanı bağlantı bilgisi bulunamadı (DIRECT_URL / DATABASE_URL).", [
    `Proje kökü      : ${projectRoot}`,
    `Yüklenen dosyalar: ${loadedEnvFiles.length ? loadedEnvFiles.join(", ") : "(hiçbiri bulunamadı)"}`,
    "",
    "Yapılması gerekenler:",
    "  1. Proje kökünde .env (veya .env.local) dosyası olduğundan emin ol.",
    "  2. İçinde şu satır bulunmalı:",
    '       DIRECT_URL="postgresql://<user>:<pass>@<host>/<db>?sslmode=require"',
    "     (Neon panelinde 'Direct connection' — içinde '-pooler' GEÇMEYEN host.)",
    "  3. Vercel kullanıyorsan: `vercel env pull .env.local`",
  ]);
}

if (usingFallback) {
  console.warn(
    "⚠️  DIRECT_URL tanımlı değil — havuzlanmış DATABASE_URL ile devam ediliyor.\n" +
      "    PgBouncer üzerinden seed sırasında bağlantı hataları görebilirsin."
  );
}

let dbHost = "(bilinmiyor)";
try {
  const parsed = new URL(connectionString);
  dbHost = parsed.host;
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    fail("Bağlantı stringi geçersiz.", [
      `Beklenen şema: postgresql://  — bulunan: ${parsed.protocol}//`,
    ]);
  }
} catch (e) {
  fail("DIRECT_URL/DATABASE_URL geçerli bir URL değil.", [
    "Değeri tırnak içine aldığından ve satır sonunda boşluk/; olmadığından emin ol.",
  ], e);
}

console.log(
  `🔌 Bağlanılıyor → ${dbHost} (${process.env.DIRECT_URL ? "DIRECT_URL" : "DATABASE_URL"})` +
    (loadedEnvFiles.length ? ` [env: ${loadedEnvFiles.join(", ")}]` : "")
);

const pool = new Pool({
  connectionString,
  max: 5,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 10_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
  statement_timeout: 30_000,
  query_timeout: 30_000,
});

pool.on("error", (err) => {
  console.error("[seed] Boştaki Postgres istemcisinde hata:", err);
});

const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

/** Bağlantıyı Prisma sorgularından önce dener; hatayı okunur hâle getirir. */
async function assertConnection() {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    console.log("✅ Veritabanı bağlantısı doğrulandı.");
  } catch (e) {
    const code = (e as { code?: string }).code;
    const hints: Record<string, string> = {
      ENOTFOUND: `Host çözümlenemedi (${dbHost}). Bağlantı stringindeki host adını ve internet erişimini kontrol et.`,
      ECONNREFUSED: "Bağlantı reddedildi. Port/host doğru mu, veritabanı ayakta mı?",
      ETIMEDOUT: "Bağlantı zaman aşımına uğradı. Neon compute uykuda olabilir veya güvenlik duvarı/VPN engelliyor olabilir.",
      "28P01": "Kimlik doğrulama başarısız — kullanıcı adı/parola hatalı. Neon'dan bağlantı stringini yeniden kopyala.",
      "3D000": "Belirtilen veritabanı yok. URL'nin sonundaki /<db> kısmını kontrol et.",
      "28000": "Kullanıcının bu veritabanına erişimi yok veya SSL zorunlu (?sslmode=require ekle).",
    };
    fail("Veritabanına bağlanılamadı.", [
      `Host      : ${dbHost}`,
      `Hata kodu : ${code ?? "(yok)"}`,
      hints[code ?? ""] ?? "Bağlantı stringini ve ağ erişimini kontrol et.",
    ], e);
  }
}

async function main() {
  await assertConnection();
  console.log("🌱 Starting seed...");

  const branch = await prisma.branch.upsert({
    where: { id: "branch-main-001" },
    update: {},
    create: {
      id: "branch-main-001",
      name: "Merkez Şube",
      location: "Konya, Türkiye",
    },
  });
  console.log(`✅ Branch created: ${branch.name}`);

  const adminHash = await bcrypt.hash("Admin1234!", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@ekremdoner.com" },
    update: {},
    create: {
      id: "user-admin-001",
      name: "Admin Kullanıcı",
      email: "admin@ekremdoner.com",
      passwordHash: adminHash,
      role: Role.ADMIN,
      branchId: branch.id,
    },
  });
  console.log(`✅ Admin created: ${admin.email}`);

  const rules = [
    {
      id: "rule-001",
      threshold: 5,
      rewardName: "1 Ücretsiz Ayran",
      isResetPoint: false,
      isActive: true,
    },
    {
      id: "rule-002",
      threshold: 7,
      rewardName: "1 Ücretsiz Sütlaç",
      isResetPoint: false,
      isActive: true,
    },
    {
      id: "rule-003",
      threshold: 15,
      rewardName: "1 Etli Ekmek Kazandınız",
      isResetPoint: true,
      isActive: true,
    },
  ];

  for (const rule of rules) {
    const created = await prisma.campaignRule.upsert({
      where: { threshold: rule.threshold },
      update: { rewardName: rule.rewardName, isResetPoint: rule.isResetPoint },
      create: rule,
    });
    console.log(
      `✅ Campaign rule: threshold=${created.threshold} → ${created.rewardName}`
    );
  }

  console.log("\n✨ Seed complete!\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔑 Login Credentials:");
  console.log("   Admin  → admin@ekremdoner.com   / Admin1234!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("\n❌ Seed başarısız oldu.\n");
    console.error("──────── Hata ────────");
    console.error(e);

    if (e instanceof Error) {
      console.error("\n──────── Stack trace ────────");
      console.error(e.stack ?? "(stack yok)");
    }

    const meta = (e as { code?: string; meta?: unknown }) ?? {};
    if (meta.code) console.error(`\nPrisma/PG hata kodu: ${meta.code}`);
    if (meta.meta) {
      console.error("meta:", JSON.stringify(meta.meta, null, 2));
    }

    let cause: unknown = (e as { cause?: unknown })?.cause;
    let depth = 0;
    while (cause && depth < 5) {
      console.error(`\n──────── cause [${depth}] ────────`);
      console.error(cause);
      if (cause instanceof Error && cause.stack) console.error(cause.stack);
      cause = (cause as { cause?: unknown })?.cause;
      depth++;
    }

    console.error(
      "\n💡 Sık karşılaşılanlar:\n" +
        "   • P2021 / 'relation does not exist' → önce `npx prisma db push` (veya migrate deploy) çalıştır.\n" +
        "   • 'PrismaClient did not initialize' → `npx prisma generate` çalıştır.\n" +
        "   • Bağlantı/timeout → .env içindeki DIRECT_URL'i ve Neon compute durumunu kontrol et.\n"
    );

    await prisma.$disconnect().catch(() => {});
    await pool.end().catch(() => {});
    process.exit(1);
  });