// prisma/seed.ts
// Run via `prisma db seed` (tsx) — a plain script, so tsconfig path aliases
// are not available: import the generated client by relative path.
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { Pool } from "pg";
import { PrismaClient, Role, RewardStatus } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

// ─── 0. Environment ─────────────────────────────────────────────────────────
// `prisma db seed` spawns this file in a FRESH node process: the dotenv call
// inside prisma.config.ts does not reach us, and Prisma 7 no longer auto-loads
// .env. So load it here explicitly. Order matters — the first file to define a
// key wins (dotenv never overwrites an already-set value), and a real shell
// env var beats both.
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
    // pg/Prisma hataları asıl sebebi çoğu zaman `cause` içinde taşır.
    const cause = (error as { cause?: unknown })?.cause;
    if (cause) {
      console.error("\n──────── cause ────────");
      console.error(cause);
    }
  }
  console.error("");
  process.exit(1);
}

// Seed her zaman DIRECT (havuzlanmamış) bağlantıyı tercih eder: PgBouncer'ın
// transaction pooling modu uzun süreli seed işlemleri ve prepared statement'lar
// için uygun değil. DATABASE_URL yalnızca yedek olarak kullanılır.
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

// Bağlantı stringini erkenden doğrula: hatalı format hâlinde pg'nin anlamsız
// "client password must be a string" gibi hatalarını görmek yerine net mesaj ver.
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

// Prisma 7'de datasource bloğunda `url` yok, bu yüzden bare `new PrismaClient()`
// çalışmaz — driver adapter zorunlu. Runtime'daki singleton (src/lib/prisma.ts)
// yerine seed'e özel, tek kullanımlık küçük bir pool açıyoruz: `server-only`
// importunu tetiklemez ve iş bitince temiz şekilde kapanır.
// max: 1 KULLANMA — Prisma bir upsert'ü kendi transaction'ı içinde çalıştırıp
// aynı anda ikinci bir bağlantı istediğinde havuz tükenir ve script sessizce
// kilitlenir. Küçük ama >1 bir havuz + timeout'lar güvenli taraf.
const pool = new Pool({
  connectionString,
  max: 5,
  connectionTimeoutMillis: 15_000,
  idleTimeoutMillis: 10_000,
  // Sessizce kopan TCP bağlantılarında script'in sonsuza kadar beklemesini
  // engeller (NAT/firewall arkasında Neon'a bağlanırken sık görülür).
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
  // Neon compute uyanırken tek bir sorgu sonsuza kadar asılı kalmasın.
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

  // ─── 1. Branch ──────────────────────────────────────────────────────────────
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

  // ─── 2. Admin User ──────────────────────────────────────────────────────────
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

  // ─── 3. Staff User ──────────────────────────────────────────────────────────
  const staffHash = await bcrypt.hash("Staff1234!", 12);
  const staff = await prisma.user.upsert({
    where: { email: "personel@ekremdoner.com" },
    update: {},
    create: {
      id: "user-staff-001",
      name: "Ahmet Personel",
      email: "personel@ekremdoner.com",
      passwordHash: staffHash,
      role: Role.STAFF,
      branchId: branch.id,
    },
  });
  console.log(`✅ Staff created: ${staff.email}`);

  // ─── 4. Campaign Rules (3 default rules) ────────────────────────────────────
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

  // Kuralları bir kez oku; her sipariş döngüsünde findUnique atmak yerine
  // threshold → kural haritasını bellekte tut (uzak DB'de round-trip pahalı).
  const ruleByThreshold = new Map(
    (await prisma.campaignRule.findMany()).map((r) => [r.threshold, r])
  );

  /** Deterministik id'lerle N sipariş oluşturur; tekrar çalıştırmada atlar. */
  async function createOrders(
    prefix: string,
    customerId: string,
    total: number
  ) {
    const data = Array.from({ length: total }, (_, idx) => {
      const i = idx + 1;
      return {
        id: `${prefix}-${i.toString().padStart(3, "0")}`,
        customerId,
        branchId: branch.id,
        staffId: staff.id,
        createdAt: new Date(Date.now() - (total + 1 - i) * 24 * 60 * 60 * 1000),
      };
    });
    // Tek INSERT — döngü içindeki N ayrı upsert yerine. skipDuplicates
    // sayesinde seed tekrar çalıştırılabilir kalır.
    const { count } = await prisma.order.createMany({
      data,
      skipDuplicates: true,
    });
    console.log(`   📦 ${total} sipariş (${count} yeni)`);
    return data;
  }

  /** Belirli bir siparişe bağlı ödülü (varsa kural) oluşturur. */
  async function createReward(opts: {
    id: string;
    customerId: string;
    orderId: string;
    threshold: number;
    status: RewardStatus;
    claimedAt?: Date;
    label?: string;
  }) {
    const rule = ruleByThreshold.get(opts.threshold);
    if (!rule) {
      console.warn(`   ⚠️  threshold=${opts.threshold} için kural yok, ödül atlandı.`);
      return;
    }
    await prisma.reward.upsert({
      where: { orderId: opts.orderId },
      update: {},
      create: {
        id: opts.id,
        customerId: opts.customerId,
        ruleId: rule.id,
        orderId: opts.orderId,
        status: opts.status,
        claimedAt: opts.claimedAt,
      },
    });
    console.log(`   ${opts.label ?? "⭐"} Reward: ${rule.rewardName} (${opts.status})`);
  }

  // ─── 5. Mock Customer 1: Ali Yılmaz (5 orders, 1 pending reward) ───────────
  const customer1 = await prisma.customer.upsert({
    where: { phone: "+905551234567" },
    update: {},
    create: {
      id: "customer-001",
      name: "Ali Yılmaz",
      phone: "+905551234567",
      qrUuid: "aaaaaaaa-0000-0000-0000-000000000001",
      currentCycleCount: 5,
      lifetimeCount: 5,
      kvkkConsent: true,
      branchId: branch.id,
    },
  });
  console.log(`✅ Customer 1: ${customer1.name} (${customer1.phone})`);

  await createOrders("order-c1", customer1.id, 5);

  // 5. siparişte bekleyen AYRAN ödülü
  await createReward({
    id: "reward-c1-ayran",
    customerId: customer1.id,
    orderId: "order-c1-005",
    threshold: 5,
    status: RewardStatus.PENDING,
  });

  // ─── 6. Mock Customer 2: Fatma Kaya (17 orders, completed 1 full cycle) ────
  const customer2 = await prisma.customer.upsert({
    where: { phone: "+905559876543" },
    update: {},
    create: {
      id: "customer-002",
      name: "Fatma Kaya",
      phone: "+905559876543",
      qrUuid: "bbbbbbbb-0000-0000-0000-000000000002",
      currentCycleCount: 2, // Completed 1 cycle (15) + 2 more
      lifetimeCount: 17,
      kvkkConsent: true,
      branchId: branch.id,
    },
  });
  console.log(`✅ Customer 2: ${customer2.name} (${customer2.phone})`);

  await createOrders("order-c2", customer2.id, 17);

  // İlk döngünün (1-15) kilometre taşı ödülleri
  const day = 24 * 60 * 60 * 1000;
  await createReward({
    id: "reward-c2-ayran",
    customerId: customer2.id,
    orderId: "order-c2-005",
    threshold: 5,
    status: RewardStatus.CLAIMED,
    claimedAt: new Date(Date.now() - 9 * day),
  });
  await createReward({
    id: "reward-c2-sutlac",
    customerId: customer2.id,
    orderId: "order-c2-007",
    threshold: 7,
    status: RewardStatus.CLAIMED,
    claimedAt: new Date(Date.now() - 7 * day),
  });
  await createReward({
    id: "reward-c2-grand",
    customerId: customer2.id,
    orderId: "order-c2-015",
    threshold: 15,
    status: RewardStatus.CLAIMED,
    claimedAt: new Date(Date.now() - 3 * day),
    label: "🎉",
  });

  console.log("\n✨ Seed complete!\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🔑 Login Credentials:");
  console.log("   Admin  → admin@ekremdoner.com   / Admin1234!");
  console.log("   Staff  → personel@ekremdoner.com / Staff1234!");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🧑‍💼 Mock Customers:");
  console.log(
    "   Ali Yılmaz  → /card/aaaaaaaa-0000-0000-0000-000000000001"
  );
  console.log(
    "      (5 stamps, 1 pending Ayran reward)"
  );
  console.log(
    "   Fatma Kaya  → /card/bbbbbbbb-0000-0000-0000-000000000002"
  );
  console.log(
    "      (17 lifetime orders, 2 current cycle, 3 claimed rewards)"
  );
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

    // Prisma hataları: hangi kural/hangi alan patladı bilgisi burada.
    const meta = (e as { code?: string; meta?: unknown }) ?? {};
    if (meta.code) console.error(`\nPrisma/PG hata kodu: ${meta.code}`);
    if (meta.meta) {
      console.error("meta:", JSON.stringify(meta.meta, null, 2));
    }

    // Asıl sebep genellikle zincirin en altındadır.
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
