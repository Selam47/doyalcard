// prisma/seed.ts
import { PrismaClient, Role, RewardStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
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

  // Create 5 orders for customer 1
  for (let i = 1; i <= 5; i++) {
    const order = await prisma.order.upsert({
      where: { id: `order-c1-${i.toString().padStart(3, "0")}` },
      update: {},
      create: {
        id: `order-c1-${i.toString().padStart(3, "0")}`,
        customerId: customer1.id,
        branchId: branch.id,
        staffId: staff.id,
        createdAt: new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000),
      },
    });

    // On 5th order, create the pending AYRAN reward
    if (i === 5) {
      const ayranRule = await prisma.campaignRule.findUnique({
        where: { threshold: 5 },
      });
      if (ayranRule) {
        await prisma.reward.upsert({
          where: { orderId: order.id },
          update: {},
          create: {
            id: "reward-c1-ayran",
            customerId: customer1.id,
            ruleId: ayranRule.id,
            orderId: order.id,
            status: RewardStatus.PENDING,
          },
        });
        console.log(
          `   ⭐ Reward: ${ayranRule.rewardName} (PENDING)`
        );
      }
    }
  }

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

  // Create 17 orders for customer 2
  for (let i = 1; i <= 17; i++) {
    const order = await prisma.order.upsert({
      where: { id: `order-c2-${i.toString().padStart(3, "0")}` },
      update: {},
      create: {
        id: `order-c2-${i.toString().padStart(3, "0")}`,
        customerId: customer2.id,
        branchId: branch.id,
        staffId: staff.id,
        createdAt: new Date(Date.now() - (18 - i) * 24 * 60 * 60 * 1000),
      },
    });

    // Milestone rewards for first cycle (orders 1-15)
    if (i === 5) {
      const ayranRule = await prisma.campaignRule.findUnique({
        where: { threshold: 5 },
      });
      if (ayranRule) {
        await prisma.reward.upsert({
          where: { orderId: order.id },
          update: {},
          create: {
            id: "reward-c2-ayran",
            customerId: customer2.id,
            ruleId: ayranRule.id,
            orderId: order.id,
            status: RewardStatus.CLAIMED,
            claimedAt: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000),
          },
        });
        console.log(`   ⭐ Reward: ${ayranRule.rewardName} (CLAIMED)`);
      }
    } else if (i === 7) {
      const sutlacRule = await prisma.campaignRule.findUnique({
        where: { threshold: 7 },
      });
      if (sutlacRule) {
        await prisma.reward.upsert({
          where: { orderId: order.id },
          update: {},
          create: {
            id: "reward-c2-sutlac",
            customerId: customer2.id,
            ruleId: sutlacRule.id,
            orderId: order.id,
            status: RewardStatus.CLAIMED,
            claimedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        });
        console.log(`   ⭐ Reward: ${sutlacRule.rewardName} (CLAIMED)`);
      }
    } else if (i === 15) {
      const grandRule = await prisma.campaignRule.findUnique({
        where: { threshold: 15 },
      });
      if (grandRule) {
        await prisma.reward.upsert({
          where: { orderId: order.id },
          update: {},
          create: {
            id: "reward-c2-grand",
            customerId: customer2.id,
            ruleId: grandRule.id,
            orderId: order.id,
            status: RewardStatus.CLAIMED,
            claimedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
          },
        });
        console.log(`   🎉 Grand Prize: ${grandRule.rewardName} (CLAIMED)`);
      }
    }
  }

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
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
