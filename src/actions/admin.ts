"use server";

import { prisma } from "@/lib/prisma";
import { getStaffPrincipal, type StaffPrincipal } from "@/lib/staff-guard";
import { revalidatePath } from "next/cache";
import { revalidateCampaignSurfaces } from "@/lib/revalidate";
import { isDbConnectionError } from "@/lib/db-errors";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";

type AdminGuard =
  | { ok: true; staff: StaffPrincipal }
  | { ok: false; error: string };

async function ensureAdmin(): Promise<AdminGuard> {
  const staff = await getStaffPrincipal();

  if (!staff) {
    return {
      ok: false,
      error: "Oturum bulunamadı veya süresi doldu. Lütfen tekrar giriş yapın.",
    };
  }

  if (!staff.isAdmin) {
    return {
      ok: false,
      error: "Yetkisiz erişim: Bu işlem yalnızca yönetici hesabına açıktır.",
    };
  }

  return { ok: true, staff };
}

async function requireAdmin(): Promise<StaffPrincipal> {
  const guard = await ensureAdmin();
  if (!guard.ok) {
    throw new Error(guard.error);
  }
  return guard.staff;
}

function describeDbError(error: unknown, fallback: string): string {
  if (isDbConnectionError(error)) {
    return "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin.";
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2003":
        return "Kayıt başka verilerle ilişkili olduğu için işlenemedi.";
      case "P2002":
        return "Bu kayıt zaten mevcut (benzersizlik kısıtı).";
      case "P2025":
        return "Kayıt bulunamadı veya başka biri tarafından silinmiş.";
    }
  }

  return fallback;
}

/**
 * Run one dashboard counter query, returning `null` — NOT `0` — on failure.
 *
 * Collapsing a failed query into 0 is the bug this guards against: "0 Toplam
 * Sipariş" is a perfectly plausible number, so a Neon outage rendered as a
 * calm, wrong dashboard instead of an error. `null` is unambiguous, and the
 * caller turns any `null` into a visible error state.
 *
 * Errors are still swallowed here rather than rethrown so that ONE failing
 * counter cannot abort the sibling queries mid-`Promise.all`; the failure is
 * carried in the value instead.
 */
async function safeCount(
  label: string,
  query: () => Promise<number>
): Promise<number | null> {
  try {
    return await query();
  } catch (error) {
    console.error(`[getDashboardStats] count failed [${label}]:`, error);
    return null;
  }
}

export interface DashboardStats {
  totalOrders: number;
  totalCustomers: number;
  totalRewards: number;
  claimedRewards: number;
  pendingRewards: number;
  branches: number;
  recentOrders: number;
}

export type DashboardStatsResult =
  | { success: true; stats: DashboardStats }
  | { success: false; error: string };

/**
 * Read the admin dashboard counters.
 *
 * Returns a discriminated result instead of throwing, per the Server Action
 * error contract in CLAUDE.md §4 — a thrown Server Action reaches the client
 * as an opaque digest, so neither the authorization message nor the database
 * error would ever be visible to the admin. Both failure modes now come back
 * as `{ success: false, error }` that the page can render.
 */
export async function getDashboardStats(): Promise<DashboardStatsResult> {
  const guard = await ensureAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  try {
    const [
      totalOrders,
      totalCustomers,
      totalRewards,
      claimedRewards,
      branches,
      recentOrders,
    ] = await Promise.all([
      safeCount("totalOrders", () => prisma.order.count()),
      safeCount("totalCustomers", () => prisma.customer.count()),
      safeCount("totalRewards", () => prisma.reward.count()),
      safeCount("claimedRewards", () =>
        prisma.reward.count({ where: { status: "CLAIMED" } })
      ),
      safeCount("branches", () =>
        prisma.branch.count({ where: { isActive: true } })
      ),
      safeCount("recentOrders", () =>
        prisma.order.count({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        })
      ),
    ]);

    // A `null` anywhere means that counter could not be read. Reporting the
    // rest as if they were complete would understate every derived figure
    // (pendingRewards especially), so the whole read fails loudly instead.
    if (
      totalOrders === null ||
      totalCustomers === null ||
      totalRewards === null ||
      claimedRewards === null ||
      branches === null ||
      recentOrders === null
    ) {
      return {
        success: false,
        error:
          "İstatistikler şu anda okunamıyor (veritabanı hatası). Gösterilen değerler eksik olabileceği için gizlendi.",
      };
    }

    return {
      success: true,
      stats: {
        totalOrders,
        totalCustomers,
        totalRewards,
        claimedRewards,
        pendingRewards: Math.max(totalRewards - claimedRewards, 0),
        branches,
        recentOrders,
      },
    };
  } catch (error) {
    console.error("[getDashboardStats] Error:", error);
    return {
      success: false,
      error: describeDbError(error, "İstatistikler yüklenemedi"),
    };
  }
}

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
  const guard = await ensureAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  try {
    const parsed = RuleSchema.safeParse({
      threshold: formData.get("threshold"),
      rewardName: formData.get("rewardName"),
      isResetPoint: formData.get("isResetPoint") === "true",
    });

    if (!parsed.success) {
      return { success: false, error: parsed.error.issues[0]?.message };
    }

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
    revalidateCampaignSurfaces();
    return { success: true };
  } catch (error) {
    console.error("[createCampaignRule] Error:", error);
    return {
      success: false,
      error: describeDbError(error, "Kural oluşturulamadı"),
    };
  }
}

export async function deleteCampaignRule(id: string) {
  const guard = await ensureAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  if (!id || typeof id !== "string") {
    return { success: false, error: "Geçersiz kural kimliği" };
  }

  try {
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

    revalidateCampaignSurfaces();

    return { success: true, id: deleted.id };
  } catch (error) {
    console.error("[deleteCampaignRule] Error:", error);

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      revalidateCampaignSurfaces();
      return { success: true, id };
    }

    return {
      success: false,
      error: describeDbError(error, "Kural silinemedi"),
    };
  }
}

export async function toggleRuleActive(id: string, isActive: boolean) {
  const guard = await ensureAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  if (!id || typeof id !== "string") {
    return { success: false, error: "Geçersiz kural kimliği" };
  }

  try {
    await prisma.campaignRule.update({
      where: { id },
      data: { isActive },
    });

    revalidateCampaignSurfaces();
    return { success: true };
  } catch (error) {
    console.error("[toggleRuleActive] Error:", error);
    return {
      success: false,
      error: describeDbError(error, "Kural durumu değiştirilemedi"),
    };
  }
}

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
  const guard = await ensureAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

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
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    console.error("[createBranch] Error:", error);
    return {
      success: false,
      error: describeDbError(error, "Şube oluşturulamadı"),
    };
  }
}

export async function deleteBranch(id: string) {
  const guard = await ensureAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

  if (!id || typeof id !== "string") {
    return { success: false, error: "Geçersiz şube kimliği" };
  }

  try {
    const branch = await prisma.branch.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, customers: true },
        },
      },
    });

    if (!branch) {
      return { success: false, error: "Şube bulunamadı veya zaten silinmiş" };
    }

    if (branch._count.users > 0 || branch._count.customers > 0) {
      return {
        success: false,
        error: `Bu şube ${branch._count.users} kullanıcı ve ${branch._count.customers} müşteriyle ilişkili. Önce onları başka bir şubeye taşıyın.`,
      };
    }

    await prisma.branch.delete({ where: { id } });
    revalidatePath("/admin/branches");
    revalidatePath("/admin");
    return { success: true, id };
  } catch (error) {
    console.error("[deleteBranch] Error:", error);

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      revalidatePath("/admin/branches");
      return { success: true, id };
    }

    return {
      success: false,
      error: describeDbError(error, "Şube silinemedi"),
    };
  }
}

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
  const guard = await ensureAdmin();
  if (!guard.ok) return { success: false, error: guard.error };

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

    const email = parsed.data.email.trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      return { success: false, error: "Bu email adresi zaten kayıtlı" };
    }

    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    await prisma.user.create({
      data: {
        name: parsed.data.name.trim(),
        email,
        passwordHash,
        role: parsed.data.role,
        branchId: parsed.data.branchId?.trim() || null,
      },
    });

    revalidatePath("/admin/staff");
    revalidatePath("/admin");
    return { success: true };
  } catch (error) {
    console.error("[createStaffUser] Error:", error);

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { success: false, error: "Bu email adresi zaten kayıtlı" };
    }

    return {
      success: false,
      error: describeDbError(error, "Kullanıcı oluşturulamadı"),
    };
  }
}

export async function toggleUserActive(id: string, isActive: boolean) {
  const guard = await ensureAdmin();
  if (!guard.ok) return { success: false, error: guard.error };
  const { staff } = guard;

  if (!id || typeof id !== "string") {
    return { success: false, error: "Geçersiz kullanıcı kimliği" };
  }
  const userId = id.trim();

  if (!isActive && staff.id === userId) {
    return {
      success: false,
      error: "Kendi hesabınızı devre dışı bırakamazsınız.",
    };
  }

  try {
    if (!isActive) {
      const lockout = await wouldLockOutLastAdmin(userId);
      if (lockout) return { success: false, error: lockout };
    }

    await prisma.user.update({
      where: { id: userId },
      data: { isActive },
    });

    revalidatePath("/admin/staff");
    return { success: true };
  } catch (error) {
    console.error("[toggleUserActive] Error:", error);
    return {
      success: false,
      error: describeDbError(error, "Kullanıcı durumu değiştirilemedi"),
    };
  }
}

/**
 * Guard against removing/disabling the only account that can still reach
 * /admin. Returns an error message when `userId` is that account, else null.
 */
async function wouldLockOutLastAdmin(userId: string): Promise<string | null> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  });

  if (!target || target.role !== "ADMIN" || !target.isActive) return null;

  const otherActiveAdmins = await prisma.user.count({
    where: { role: "ADMIN", isActive: true, id: { not: userId } },
  });

  if (otherActiveAdmins > 0) return null;

  return "Sistemdeki son aktif yönetici hesabı silinemez veya kapatılamaz. Önce başka bir yönetici oluşturun.";
}

export type DeleteStaffUserResult =
  | { success: true; id: string; detachedOrders: number }
  | { success: false; error: string };

/**
 * Delete a staff/admin account.
 *
 * The previous implementation refused outright whenever the user had ever
 * touched an order — which permanently pinned every real cashier in the list,
 * since taking orders is the job. `Order.staffId` is declared
 * `onDelete: SetNull` precisely so the order history survives the person: the
 * rows are detached first, then the user row goes, both inside one
 * `$transaction()` so a failure can never leave orders orphaned from a user
 * that still exists (or vice versa).
 */
export async function deleteStaffUser(
  id: string
): Promise<DeleteStaffUserResult> {
  const guard = await ensureAdmin();
  if (!guard.ok) return { success: false, error: guard.error };
  const { staff } = guard;

  if (typeof id !== "string" || id.trim().length === 0) {
    return { success: false, error: "Geçersiz kullanıcı kimliği" };
  }
  const userId = id.trim();

  if (staff.id === userId) {
    return {
      success: false,
      error:
        "Kendi hesabınızı silemezsiniz. Bu işlem için başka bir yönetici hesabıyla giriş yapın.",
    };
  }

  try {
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, _count: { select: { orders: true } } },
    });

    if (!target) {
      return { success: false, error: "Kullanıcı bulunamadı veya zaten silinmiş" };
    }

    const lockout = await wouldLockOutLastAdmin(userId);
    if (lockout) return { success: false, error: lockout };

    const detachedOrders = target._count.orders;

    await prisma.$transaction([
      prisma.order.updateMany({
        where: { staffId: userId },
        data: { staffId: null },
      }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    revalidatePath("/admin/staff");
    revalidatePath("/admin");
    return { success: true, id: userId, detachedOrders };
  } catch (error) {
    console.error("[deleteStaffUser] Error:", error);

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      revalidatePath("/admin/staff");
      return { success: true, id: userId, detachedOrders: 0 };
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return {
        success: false,
        error:
          "Kullanıcı başka kayıtlarla ilişkili olduğu için silinemedi. Hesabı silmek yerine devre dışı bırakabilirsiniz.",
      };
    }

    return {
      success: false,
      error: describeDbError(error, "Kullanıcı silinemedi. Lütfen tekrar deneyin."),
    };
  }
}
