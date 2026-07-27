// src/actions/admin.ts
"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { revalidateCampaignSurfaces } from "@/lib/revalidate";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";

// ─── Auth Guard Helper ────────────────────────────────────────────────────────
async function requireAdmin() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    throw new Error("Yetkisiz erişim: Yalnızca Admin");
  }
  return session;
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
export async function getDashboardStats() {
  await requireAdmin();

  try {
    const [
      totalOrders,
      totalCustomers,
      totalRewards,
      claimedRewards,
      branches,
      recentOrders,
    ] = await Promise.all([
      prisma.order.count(),
      prisma.customer.count(),
      prisma.reward.count(),
      prisma.reward.count({ where: { status: "CLAIMED" } }),
      prisma.branch.count(),
      prisma.order.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
          },
        },
      }),
    ]);

    return {
      totalOrders,
      totalCustomers,
      totalRewards,
      claimedRewards,
      pendingRewards: totalRewards - claimedRewards,
      branches,
      recentOrders,
    };
  } catch (error) {
    console.error("[getDashboardStats] Error:", error);
    throw new Error("İstatistikler yüklenemedi");
  }
}

// ─── Campaign Rules CRUD ──────────────────────────────────────────────────────
export async function getCampaignRules() {
  await requireAdmin();

  try {
    return await prisma.campaignRule.findMany({
      orderBy: { threshold: "asc" },
      include: {
        _count: {
          select: { rewards: true },
        },
      },
    });
  } catch (error) {
    console.error("[getCampaignRules] Error:", error);
    throw new Error("Kampanya kuralları yüklenemedi");
  }
}

// Upper bound is a sanity limit only — the campaign length is fully
// admin-configurable (10, 15, 20, 40 ...) and every card + staff counter
// follows whatever is set here. It must NOT be pinned to 15.
const MAX_RULE_THRESHOLD = 100;

const RuleSchema = z.object({
  threshold: z.coerce
    .number()
    .int()
    .min(1, "Eşik değeri en az 1 olmalı")
    .max(MAX_RULE_THRESHOLD, `Eşik değeri en fazla ${MAX_RULE_THRESHOLD} olabilir`),
  rewardName: z
    .string()
    .min(2, "Ödül adı en az 2 karakter olmalı")
    .max(100, "Ödül adı en fazla 100 karakter olabilir"),
  isResetPoint: z.coerce.boolean(),
});

export async function createCampaignRule(formData: FormData) {
  await requireAdmin();

  try {
    const parsed = RuleSchema.safeParse({
      threshold: formData.get("threshold"),
      rewardName: formData.get("rewardName"),
      isResetPoint: formData.get("isResetPoint") === "true",
    });

    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message };
    }

    // Check for duplicate threshold
    const existing = await prisma.campaignRule.findUnique({
      where: { threshold: parsed.data.threshold },
    });

    if (existing) {
      return {
        success: false,
        error: "Bu eşik değeri için zaten bir kural mevcut",
      };
    }

    await prisma.campaignRule.create({ data: parsed.data });
    // A rule change alters maxStamps for EVERY customer — purge all cards.
    revalidateCampaignSurfaces();
    return { success: true };
  } catch (error) {
    console.error("[createCampaignRule] Error:", error);
    return { success: false, error: "Kural oluşturulamadı" };
  }
}

export async function updateCampaignRule(id: string, formData: FormData) {
  await requireAdmin();

  try {
    const parsed = RuleSchema.safeParse({
      threshold: formData.get("threshold"),
      rewardName: formData.get("rewardName"),
      isResetPoint: formData.get("isResetPoint") === "true",
    });

    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message };
    }

    // Check if threshold already exists for a different rule
    const existing = await prisma.campaignRule.findUnique({
      where: { threshold: parsed.data.threshold },
    });

    if (existing && existing.id !== id) {
      return {
        success: false,
        error: "Bu eşik değeri başka bir kural tarafından kullanılıyor",
      };
    }

    await prisma.campaignRule.update({
      where: { id },
      data: parsed.data,
    });

    revalidateCampaignSurfaces();
    return { success: true };
  } catch (error) {
    console.error("[updateCampaignRule] Error:", error);
    return { success: false, error: "Kural güncellenemedi" };
  }
}

export async function deleteCampaignRule(id: string) {
  await requireAdmin();

  if (!id || typeof id !== "string") {
    return { success: false, error: "Geçersiz kural kimliği" };
  }

  try {
    // Check if rule has associated rewards
    const rewardsCount = await prisma.reward.count({
      where: { ruleId: id },
    });

    if (rewardsCount > 0) {
      return {
        success: false,
        error: `Bu kural ${rewardsCount} ödülle ilişkili. Silemezsiniz.`,
      };
    }

    const deleted = await prisma.campaignRule.delete({ where: { id } });

    // Purge every cached RSC payload that quotes a threshold so a subsequent
    // router.refresh() (or a hard page reload) reliably reflects the delete.
    revalidateCampaignSurfaces();

    return { success: true, id: deleted.id };
  } catch (error) {
    console.error("[deleteCampaignRule] Error:", error);

    // Prisma throws P2025 when the record no longer exists — treat that as
    // an already-deleted rule rather than a generic failure so the UI can
    // still remove it from the list.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      revalidateCampaignSurfaces();
      return { success: true, id };
    }

    return { success: false, error: "Kural silinemedi" };
  }
}

export async function toggleRuleActive(id: string, isActive: boolean) {
  await requireAdmin();

  try {
    await prisma.campaignRule.update({
      where: { id },
      data: { isActive },
    });

    // Activating/deactivating a rule can change maxStamps globally.
    revalidateCampaignSurfaces();
    return { success: true };
  } catch (error) {
    console.error("[toggleRuleActive] Error:", error);
    return { success: false, error: "Kural durumu değiştirilemedi" };
  }
}

// ─── Branch Management ────────────────────────────────────────────────────────
export async function getBranches() {
  await requireAdmin();

  try {
    return await prisma.branch.findMany({
      include: {
        _count: {
          select: { users: true, customers: true, orders: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  } catch (error) {
    console.error("[getBranches] Error:", error);
    throw new Error("Şubeler yüklenemedi");
  }
}

const BranchSchema = z.object({
  name: z
    .string()
    .min(2, "Şube adı en az 2 karakter olmalı")
    .max(100, "Şube adı en fazla 100 karakter olabilir"),
  location: z.string().max(200, "Konum en fazla 200 karakter olabilir").optional(),
});

export async function createBranch(formData: FormData) {
  await requireAdmin();

  try {
    const parsed = BranchSchema.safeParse({
      name: formData.get("name"),
      location: formData.get("location") || undefined,
    });

    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message };
    }

    await prisma.branch.create({
      data: {
        name: parsed.data.name.trim(),
        location: parsed.data.location?.trim(),
      },
    });

    revalidatePath("/admin/branches");
    return { success: true };
  } catch (error) {
    console.error("[createBranch] Error:", error);
    return { success: false, error: "Şube oluşturulamadı" };
  }
}

export async function deleteBranch(id: string) {
  await requireAdmin();

  try {
    // Check if branch has associated users or customers
    const branch = await prisma.branch.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, customers: true },
        },
      },
    });

    if (!branch) {
      return { success: false, error: "Şube bulunamadı" };
    }

    if (branch._count.users > 0 || branch._count.customers > 0) {
      return {
        success: false,
        error: `Bu şube ${branch._count.users} kullanıcı ve ${branch._count.customers} müşteriyle ilişkili. Silemezsiniz.`,
      };
    }

    await prisma.branch.delete({ where: { id } });
    revalidatePath("/admin/branches");
    return { success: true };
  } catch (error) {
    console.error("[deleteBranch] Error:", error);
    return { success: false, error: "Şube silinemedi" };
  }
}

// ─── Staff Management ─────────────────────────────────────────────────────────
export async function getStaffUsers() {
  await requireAdmin();

  try {
    return await prisma.user.findMany({
      include: {
        branch: { select: { name: true } },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  } catch (error) {
    console.error("[getStaffUsers] Error:", error);
    throw new Error("Personel listesi yüklenemedi");
  }
}

const CreateUserSchema = z.object({
  name: z
    .string()
    .min(2, "Ad en az 2 karakter olmalı")
    .max(100, "Ad en fazla 100 karakter olabilir"),
  email: z.string().email("Geçerli bir email adresi girin"),
  password: z
    .string()
    .min(8, "Şifre en az 8 karakter olmalı")
    .max(100, "Şifre en fazla 100 karakter olabilir"),
  role: z.enum(["STAFF", "ADMIN"], {
  message: "Geçerli bir rol seçin",
}),
  branchId: z.string().optional(),
});

export async function createStaffUser(formData: FormData) {
  await requireAdmin();

  try {
    const parsed = CreateUserSchema.safeParse({
      name: formData.get("name"),
      email: formData.get("email"),
      password: formData.get("password"),
      role: formData.get("role"),
      branchId: formData.get("branchId") || undefined,
    });

    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message };
    }

    // Check for duplicate email
    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });

    if (existing) {
      return { success: false, error: "Bu email adresi zaten kayıtlı" };
    }

    // Hash password
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    await prisma.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash,
        role: parsed.data.role as "STAFF" | "ADMIN",
        branchId: parsed.data.branchId ?? null,
      },
    });

    revalidatePath("/admin/staff");
    return { success: true };
  } catch (error) {
    console.error("[createStaffUser] Error:", error);
    return { success: false, error: "Kullanıcı oluşturulamadı" };
  }
}

export async function toggleUserActive(id: string, isActive: boolean) {
  await requireAdmin();

  try {
    await prisma.user.update({
      where: { id },
      data: { isActive },
    });

    revalidatePath("/admin/staff");
    return { success: true };
  } catch (error) {
    console.error("[toggleUserActive] Error:", error);
    return { success: false, error: "Kullanıcı durumu değiştirilemedi" };
  }
}

export async function deleteStaffUser(id: string) {
  await requireAdmin();

  try {
    const session = await auth();
    
    // Prevent self-deletion
    if (session?.user?.id === id) {
      return { success: false, error: "Kendi hesabınızı silemezsiniz" };
    }

    // Check if user has associated orders
    const ordersCount = await prisma.order.count({
      where: { staffId: id },
    });

    if (ordersCount > 0) {
      return {
        success: false,
        error: `Bu kullanıcı ${ordersCount} sipariş kaydıyla ilişkili. Silemezsiniz.`,
      };
    }

    await prisma.user.delete({ where: { id } });
    revalidatePath("/admin/staff");
    return { success: true };
  } catch (error) {
    console.error("[deleteStaffUser] Error:", error);
    return { success: false, error: "Kullanıcı silinemedi" };
  }
}
