// src/actions/customer.ts
"use server";

import { prisma } from "@/lib/prisma";
import { authorizeStaff } from "@/lib/staff-guard";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { isValidE164, sanitizePhoneInput } from "@/lib/phone";
import { isDbConnectionError } from "@/lib/db-errors";
import { getCustomerSession } from "@/lib/customer-session";
import { revalidateStampSurfaces } from "@/lib/revalidate";

// ─── Validation Schemas ───────────────────────────────────────────────────────
const RegisterSchema = z.object({
  name: z
    .string()
    .min(2, "Ad en az 2 karakter olmalı")
    .max(100, "Ad en fazla 100 karakter olabilir")
    .trim(),
  // Loosely validated here (format/length only) — the strict E.164 check
  // happens after normalization below, so we can give a clearer error
  // message ("must include country code") instead of a generic regex miss.
  phone: z
    .string()
    .min(10, "Geçerli bir telefon numarası girin")
    .max(20, "Geçerli bir telefon numarası girin")
    .regex(/^[+]?[\d\s()-]+$/, "Geçerli bir telefon numarası formatı girin"),
  kvkkConsent: z.boolean().refine((val) => val === true, {
  message: "KVKK onayı zorunludur",
}),
});

export type RegisterResult =
  | { success: true; customer: { id: string; qrUuid: string; name: string } }
  | { success: false; error: string };

/**
 * Register a new customer (Staff/Admin only)
 * Validates input, checks for duplicates, and creates customer with QR UUID
 */
export async function registerCustomer(
  formData: FormData
): Promise<RegisterResult> {
  // ─── 1. Authentication & Authorization ─────────────────────────────────────
  const guard = await authorizeStaff();
  if (!guard.ok) return { success: false, error: guard.error };
  const { staff } = guard;

  try {
    // ─── 2. Parse & Validate Input ─────────────────────────────────────────────
    const raw = {
      name: formData.get("name") as string,
      phone: formData.get("phone") as string,
      kvkkConsent: formData.get("kvkkConsent") === "true",
    };

    const parsed = RegisterSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Geçersiz form verisi",
      };
    }

    const { name, phone } = parsed.data;

    // ─── 3. Normalize & Enforce E.164 ──────────────────────────────────────────
    // Every customer record must be keyed on the same canonical phone format
    // Firebase Auth produces, or a customer registered manually by staff
    // won't match up with themselves when they later sign in via OTP.
    const normalizedPhone = sanitizePhoneInput(phone);
    if (!isValidE164(normalizedPhone)) {
      return {
        success: false,
        error: "Telefon numarası ülke koduyla birlikte girilmeli (örn: +905551234567)",
      };
    }

    // ─── 4. Check for Duplicate ────────────────────────────────────────────────
    const existing = await prisma.customer.findUnique({
      where: { phone: normalizedPhone },
    });

    if (existing) {
      return {
        success: false,
        error: "Bu telefon numarasıyla kayıtlı bir müşteri zaten mevcut",
      };
    }

    // ─── 5. Create Customer ────────────────────────────────────────────────────
    const customer = await prisma.customer.create({
      data: {
        name,
        phone: normalizedPhone,
        kvkkConsent: true,
        kvkkConsentAt: new Date(),
        branchId: staff.branchId,
      },
      select: { id: true, qrUuid: true, name: true, phone: true },
    });

    // ─── 6. Revalidate & Log ───────────────────────────────────────────────────
    revalidatePath("/staff");
    revalidatePath("/staff/register");
    // Log the id only — a phone number is personal data (KVKK) and does
    // not belong in production logs.
    console.log(`[registerCustomer] New customer registered: ${customer.id}`);

    return {
      success: true,
      customer: {
        id: customer.id,
        qrUuid: customer.qrUuid,
        name: customer.name,
      },
    };
  } catch (error) {
    // ─── 7. Error Handling ─────────────────────────────────────────────────────
    console.error("[registerCustomer] Error:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unique constraint")) {
        return {
          success: false,
          error: "Bu telefon numarası zaten kayıtlı",
        };
      }
    }

    if (isDbConnectionError(error)) {
      return {
        success: false,
        error: "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin.",
      };
    }

    return {
      success: false,
      error: "Kayıt yapılamadı. Lütfen tekrar deneyin.",
    };
  }
}

// ─── Delete Customer (ADMIN only) ─────────────────────────────────────────────

/**
 * Failure shape of {@link deleteCustomer}.
 *
 * There is deliberately no `{ success: true }` variant: on success the action
 * redirects to `/staff`, so the promise only ever *resolves* when something
 * went wrong. Callers can therefore treat any resolved value as an error.
 */
export type DeleteCustomerResult = { success: false; error: string };

/**
 * Permanently delete a customer together with every record that belongs to
 * them (KVKK "right to erasure"). ADMIN only.
 *
 * The rewards → orders → customer sequence runs inside a single
 * `prisma.$transaction()`, so a failure at any step rolls the whole thing
 * back and the customer is never left half-deleted.
 *
 * @param customerId `Customer.id` (cuid), not the public `qrUuid`.
 */
export async function deleteCustomer(
  customerId: string
): Promise<DeleteCustomerResult> {
  // ─── 1. Authentication & Authorization ─────────────────────────────────────
  // Enforced *inside* the Server Action — a hidden button is not a permission
  // check, and Server Actions are publicly callable endpoints. The ADMIN role
  // is read from the database, so an account demoted or deactivated since its
  // token was issued cannot erase a customer.
  const guard = await authorizeStaff({ adminOnly: true });
  if (!guard.ok) return { success: false, error: guard.error };
  const { staff } = guard;

  // ─── 2. Input Validation ───────────────────────────────────────────────────
  if (typeof customerId !== "string" || customerId.trim().length === 0) {
    return { success: false, error: "Geçersiz müşteri kimliği" };
  }
  const id = customerId.trim();

  // Filled inside the try below. `redirect()` works by throwing, so it MUST be
  // called after the try/catch — inside it, the catch block would swallow the
  // navigation and report it as a database failure.
  let deleted: { name: string; qrUuid: string } | null = null;

  try {
    // ─── 3. Resolve the customer ─────────────────────────────────────────────
    // qrUuid is needed for cache invalidation *after* the row is gone, and the
    // name gives the success toast something to show.
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { name: true, qrUuid: true },
    });

    if (!customer) {
      return { success: false, error: "Müşteri bulunamadı" };
    }

    // ─── 4. Atomic cascade delete ────────────────────────────────────────────
    // Children before parent. Rewards reference both Customer and Order, so
    // they have to go first even though the schema declares onDelete: Cascade
    // — doing it explicitly keeps the behaviour identical if the FK policy is
    // ever tightened to Restrict for revenue reporting (see schema comment).
    await prisma.$transaction([
      prisma.reward.deleteMany({ where: { customerId: id } }),
      prisma.order.deleteMany({ where: { customerId: id } }),
      prisma.customer.delete({ where: { id } }),
    ]);

    deleted = { name: customer.name, qrUuid: customer.qrUuid };
  } catch (error) {
    // ─── 5. Error Handling ───────────────────────────────────────────────────
    console.error("[deleteCustomer] Error:", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2025 — the row disappeared between the lookup and the delete
      // (another admin got there first). Not a real failure for the user.
      if (error.code === "P2025") {
        return { success: false, error: "Müşteri bulunamadı veya zaten silinmiş" };
      }
      // P2003 — a foreign key elsewhere still points at this customer.
      if (error.code === "P2003") {
        return {
          success: false,
          error:
            "Müşteri başka kayıtlarla ilişkili olduğu için silinemedi. Lütfen yöneticinize başvurun.",
        };
      }
    }

    if (isDbConnectionError(error)) {
      return {
        success: false,
        error: "Veritabanı bağlantısı zaman aşımına uğradı. Lütfen tekrar deneyin.",
      };
    }

    return { success: false, error: "Müşteri silinemedi. Lütfen tekrar deneyin." };
  }

  if (!deleted) {
    return { success: false, error: "Müşteri silinemedi. Lütfen tekrar deneyin." };
  }

  console.log(
    `[deleteCustomer] ${deleted.name} (${id}) deleted by ${staff.email}`
  );

  // ─── 6. Cache Invalidation ─────────────────────────────────────────────────
  // revalidateStampSurfaces() performs revalidatePath("/staff") and
  // revalidatePath(`/card/${qrUuid}`), plus the `/card/[uuid]` pattern form
  // that the concrete path alone does not cover (see src/lib/revalidate.ts).
  revalidateStampSurfaces(deleted.qrUuid);

  // ─── 7. Redirect ───────────────────────────────────────────────────────────
  // The `deleted` param is consumed once by /staff to raise the success toast
  // and then stripped from the URL. Never returns.
  redirect(`/staff?deleted=${encodeURIComponent(deleted.name)}`);
}

/**
 * Search customers by phone number (Staff/Admin only)
 * Supports partial matching for flexible search
 */
export async function searchCustomerByPhone(phone: string) {
  // ─── 1. Authentication Check ───────────────────────────────────────────────
  const guard = await authorizeStaff();
  if (!guard.ok) return null;

  // ─── 2. Input Validation ───────────────────────────────────────────────────
  if (!phone || typeof phone !== "string" || phone.trim().length < 3) {
    return null;
  }

  try {
    // ─── 3. Normalize Search Query ─────────────────────────────────────────────
    const normalized = phone.replace(/[\s()-]/g, "");

    // ─── 4. Search Database ────────────────────────────────────────────────────
    const customer = await prisma.customer.findFirst({
      where: {
        phone: {
          contains: normalized,
        },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        qrUuid: true,
        currentCycleCount: true,
        lifetimeCount: true,
        createdAt: true,
        branch: { select: { name: true } },
        rewards: {
          where: { status: "PENDING" },
          include: { rule: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return customer;
  } catch (error) {
    console.error("[searchCustomerByPhone] Error:", error);
    return null;
  }
}

// NOTE: `getCustomerByUuid()` used to live here as an UNAUTHENTICATED exported
// Server Action. Because every export of a "use server" module is a publicly
// callable endpoint, anyone who guessed or harvested a qrUuid could pull a
// customer's name, phone, order history and reward history straight out of the
// database — no session of any kind required.
//
// The query now lives in `src/lib/card-access.ts`, which is a plain
// server-only module (NOT a Server Action), and every caller goes through
// `resolveCardAccess()` / `resolveStaffCardAccess()` so read access is proven
// before the row is fetched.

/**
 * Get customer by ID (for the customer self-service dashboard)
 * Server Actions are publicly callable endpoints, so the customer session
 * cookie is verified HERE and must match the requested id — never trust the
 * caller to have done it.
 */
export async function getCustomerById(id: string) {
  if (!id || typeof id !== "string") return null;

  const session = await getCustomerSession();
  if (!session || session.customerId !== id) return null;

  try {
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        phone: true,
        qrUuid: true,
        currentCycleCount: true,
        lifetimeCount: true,
        createdAt: true,
        branch: { select: { name: true, location: true } },
        rewards: {
          orderBy: { createdAt: "desc" },
          include: {
            rule: true,
            order: { select: { createdAt: true } },
          },
        },
      },
    });

    return customer;
  } catch (error) {
    console.error("[getCustomerById] Error:", error);
    return null;
  }
}
