// src/actions/admin.ts
"use server";

import { prisma } from "@/lib/prisma";
import { getStaffPrincipal, type StaffPrincipal } from "@/lib/staff-guard";
import { revalidatePath } from "next/cache";
import { revalidateCampaignSurfaces } from "@/lib/revalidate";
import { isDbConnectionError } from "@/lib/db-errors";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";

// ─── Auth Guards ──────────────────────────────────────────────────────────────
// Two flavours on purpose:
//
//  • ensureAdmin() — for MUTATIONS. Returns a discriminated result instead of
//    throwing. A Server Action that throws crosses the RSC boundary as an
//    opaque "An error occurred in the Server Components render" digest, which
//    the client `await` sees as a rejected promise inside startTransition →
//    unhandled rejection → error overlay. A returned `{ success: false }` lets
//    the UI raise a proper toast (e.g. after the session silently expires).
//
//  • requireAdmin() — for READS rendered by a Server Component page, where a
//    thrown error is caught by the route's error boundary as intended.
//
// Both resolve the caller through getStaffPrincipal(), which re-reads the user
// row from the DATABASE. Trusting `auth()` alone would mean an admin who was
// demoted to STAFF, deactivated, or deleted keeps full staff-management and
// campaign-rule powers until their JWT expires — up to 30 days.
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

// ─── Shared Error Mapper ──────────────────────────────────────────────────────
// Turns a Prisma/driver failure into a message a cashier can act on, instead
// of the generic "işlem yapılamadı" that hides FK violations and Neon cold
// starts behind the same string.
function describeDbError(error: unknown, fallback: string): string {
  if (isDbConnectionError(error)) {
    return "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin.";
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      // Foreign key violation — a relation the schema does not nullify/cascade.
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

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
// Tek bir sorgu patladığında tüm admin panelinin çökmemesi için her sorgu
// kendi hata sınırında çalışır: başarısız olan sorgu detaylı loglanır ve
// güvenli varsayılan (0) döner. Promise.all burada asla reject olmaz çünkü
// safeCount hiçbir zaman throw etmez.
async function safeCount(
  label: string,
  query: () => Promise<number>
): Promise<number> {
  try {
    return await query();
  } catch (error) {
    // Prisma/DB hatasının detayını kaybetme — Vercel loglarında görünsün.
    console.error(`Admin stats fetch error [${label}]:`, error);
    return 0;
  }
}

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
      safeCount("totalOrders", () => prisma.order.count()),
      safeCount("totalCustomers", () => prisma.customer.count()),
      safeCount("totalRewards", () => prisma.reward.count()),
      safeCount("claimedRewards", () =>
        prisma.reward.count({ where: { status: "CLAIMED" } })
      ),
      // Dashboard kartı "Aktif Şube" gösteriyor — pasif şubeleri sayma.
      safeCount("branches", () =>
        prisma.branch.count({ where: { isActive: true } })
      ),
      safeCount("recentOrders", () =>
        prisma.order.count({
          where: {
            createdAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
            },
          },
        })
      ),
    ]);

    return {
      totalOrders,
      totalCustomers,
      totalRewards,
      claimedRewards,
      pendingRewards: Math.max(totalRewards - claimedRewards, 0),
      branches,
      recentOrders,
    };
  } catch (error) {
    // safeCount sayesinde buraya normalde düşülmez; yine de beklenmedik bir
    // hata olursa (ör. auth sonrası runtime hatası) paneli çökertme.
    console.error("Admin stats fetch error:", error);
    return {
      totalOrders: 0,
      totalCustomers: 0,
      totalRewards: 0,
      claimedRewards: 0,
      pendingRewards: 0,
      branches: 0,
      recentOrders: 0,
    };
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

    // Activating/deactivating a rule can change maxStamps globally.
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
      return { success: false, error: "Şube bulunamadı veya zaten silinmiş" };
    }

    // Deliberate business rule (NOT a schema limitation): the FKs are
    // onDelete: SetNull, so Postgres would happily orphan every staff member
    // and customer of this branch. Refuse instead and make the admin move
    // them first, otherwise a mis-click silently unassigns the whole store.
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

    // Already gone — let the UI drop the card instead of showing a failure.
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

    // Email is stored/compared verbatim, and NextAuth looks the user up with
    // findUnique({ email }) — so "Admin@X.com" would create a second account
    // that can never log in with the address the admin typed. Normalize once,
    // here, and use the normalized value for both the check and the insert.
    const email = parsed.data.email.trim().toLowerCase();

    // Check for duplicate email
    const existing = await prisma.user.findUnique({ where: { email } });

    if (existing) {
      return { success: false, error: "Bu email adresi zaten kayıtlı" };
    }

    // Hash password
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);

    await prisma.user.create({
      data: {
        name: parsed.data.name.trim(),
        email,
        passwordHash,
        role: parsed.data.role,
        // "" from an unselected <select> is not a valid Branch id — it would
        // fail the FK (P2003). Empty string means "no branch".
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

  // authorize() rejects `!user.isActive`, so deactivating yourself is an
  // instant self-lockout on the next request.
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

  // Only an ACTIVE admin is currently keeping the door open.
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

  // ─── Input validation ──────────────────────────────────────────────────────
  if (typeof id !== "string" || id.trim().length === 0) {
    return { success: false, error: "Geçersiz kullanıcı kimliği" };
  }
  const userId = id.trim();

  // ─── Self-deletion ─────────────────────────────────────────────────────────
  // Checked before any DB round-trip: it is an authorization decision, not a
  // data problem.
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

    // ─── Last-admin guard ────────────────────────────────────────────────────
    const lockout = await wouldLockOutLastAdmin(userId);
    if (lockout) return { success: false, error: lockout };

    const detachedOrders = target._count.orders;

    // ─── Atomic detach + delete ──────────────────────────────────────────────
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

    // P2025 — another admin deleted the same row first. Not a failure from
    // this admin's point of view; the goal state is reached either way.
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
