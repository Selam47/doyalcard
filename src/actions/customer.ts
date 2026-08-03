"use server";

import { prisma } from "@/lib/prisma";
import { authorizeStaff } from "@/lib/staff-guard";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { isValidE164, normalizePhoneToE164 } from "@/lib/phone";
import { isDbConnectionError } from "@/lib/db-errors";
import { getCustomerSession } from "@/lib/customer-session";
import { revalidateStampSurfaces } from "@/lib/revalidate";

const RegisterSchema = z.object({
  name: z
    .string()
    .min(2, "Ad en az 2 karakter olmalı")
    .max(100, "Ad en fazla 100 karakter olabilir")
    .trim(),
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
  const guard = await authorizeStaff();
  if (!guard.ok) return { success: false, error: guard.error };
  const { staff } = guard;

  try {
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

    /*
     * Same normalizer the customer's own OTP login uses. Registration used to
     * call `sanitizePhoneInput`, which returns the number exactly as typed —
     * so a cashier entering "0530 916 28 63" stored "05309162863" while the
     * same person logging in by SMS stored "+905309162863". Two spellings of
     * one human means the UNIQUE index never fires, the OTP callback cannot
     * find the staff-created row, and a phone search matches whichever one it
     * happens to hit.
     */
    const normalizedPhone = normalizePhoneToE164(phone);
    if (!normalizedPhone || !isValidE164(normalizedPhone)) {
      return {
        success: false,
        error: "Geçerli bir telefon numarası girin (örn: 0530 123 45 67 veya +905301234567)",
      };
    }

    const existing = await prisma.customer.findUnique({
      where: { phone: normalizedPhone },
    });

    if (existing) {
      return {
        success: false,
        error: "Bu telefon numarasıyla kayıtlı bir müşteri zaten mevcut",
      };
    }

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

    revalidatePath("/staff");
    revalidatePath("/staff/register");
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
  const guard = await authorizeStaff({ adminOnly: true });
  if (!guard.ok) return { success: false, error: guard.error };
  const { staff } = guard;

  if (typeof customerId !== "string" || customerId.trim().length === 0) {
    return { success: false, error: "Geçersiz müşteri kimliği" };
  }
  const id = customerId.trim();

  let deleted: { name: string; qrUuid: string } | null = null;

  try {
    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { name: true, qrUuid: true },
    });

    if (!customer) {
      return { success: false, error: "Müşteri bulunamadı" };
    }

    await prisma.$transaction([
      prisma.reward.deleteMany({ where: { customerId: id } }),
      prisma.order.deleteMany({ where: { customerId: id } }),
      prisma.customer.delete({ where: { id } }),
    ]);

    deleted = { name: customer.name, qrUuid: customer.qrUuid };
  } catch (error) {
    console.error("[deleteCustomer] Error:", error);

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return { success: false, error: "Müşteri bulunamadı veya zaten silinmiş" };
      }
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

  revalidateStampSurfaces(deleted.qrUuid);

  redirect(`/staff?deleted=${encodeURIComponent(deleted.name)}`);
}

/**
 * Look a customer up by phone number (Staff/Admin only).
 *
 * EXACT match on the normalized E.164 number — never a partial one.
 *
 * This used to be `findFirst({ where: { phone: { contains: normalized } } })`,
 * which is how a search could quietly hand back the WRONG PERSON: "530" (or
 * any fragment two customers share) matched several rows and `findFirst`
 * returned whichever one Postgres happened to yield, with no ordering and no
 * hint to the cashier that the match was ambiguous. Stamping the card that came
 * back then credited a stranger's account.
 *
 * `phone` is UNIQUE, so normalizing the input first and asking for that one row
 * makes the result provably the number that was typed, or nothing at all.
 */
export async function searchCustomerByPhone(phone: string) {
  const guard = await authorizeStaff();
  if (!guard.ok) return null;

  if (!phone || typeof phone !== "string") return null;

  const normalized = normalizePhoneToE164(phone);
  if (!normalized) return null;

  try {
    const customer = await prisma.customer.findUnique({
      where: { phone: normalized },
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

    if (!customer) return null;

    /*
     * Cross-check the row against the OTHER claim in the session.
     *
     * The token carries both `customerId` and the phone number that Firebase
     * actually verified, and they were written together at login. If the row
     * behind that id no longer carries that number, the two disagree — the
     * session belongs to somebody else, or the record was re-keyed underneath
     * it. Either way the honest answer is "no customer", not a card belonging
     * to whoever now owns the id.
     *
     * This is the invariant that makes a wrong-identity render impossible
     * rather than merely unlikely: the dashboard cannot paint a name unless
     * the phone that passed OTP still matches the row being painted.
     */
    if (customer.phone !== session.phone) {
      console.error(
        "[getCustomerById] session/record mismatch — oturum reddedildi. " +
          `customerId=${id} oturumdaki telefon ile kayıttaki telefon farklı.`
      );
      return null;
    }

    return customer;
  } catch (error) {
    console.error("[getCustomerById] Error:", error);
    return null;
  }
}
