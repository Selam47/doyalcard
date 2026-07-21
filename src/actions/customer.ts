// src/actions/customer.ts
"use server";

import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";

// ─── Validation Schemas ───────────────────────────────────────────────────────
const RegisterSchema = z.object({
  name: z
    .string()
    .min(2, "Ad en az 2 karakter olmalı")
    .max(100, "Ad en fazla 100 karakter olabilir")
    .trim(),
  phone: z
    .string()
    .min(10, "Geçerli bir telefon numarası girin")
    .max(15, "Geçerli bir telefon numarası girin")
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
  const session = await auth();
  if (!session?.user || !["STAFF", "ADMIN"].includes(session.user.role)) {
    return { success: false, error: "Yetkisiz erişim" };
  }

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

    // ─── 3. Normalize Phone Number ─────────────────────────────────────────────
    const normalizedPhone = phone.replace(/[\s()-]/g, "");

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
        branchId: session.user.branchId ?? null,
      },
      select: { id: true, qrUuid: true, name: true, phone: true },
    });

    // ─── 6. Revalidate & Log ───────────────────────────────────────────────────
    revalidatePath("/staff");
    revalidatePath("/staff/register");
    console.log(`[registerCustomer] New customer: ${customer.name} (${customer.phone})`);

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

    return {
      success: false,
      error: "Kayıt yapılamadı. Lütfen tekrar deneyin.",
    };
  }
}

/**
 * Search customers by phone number (Staff/Admin only)
 * Supports partial matching for flexible search
 */
export async function searchCustomerByPhone(phone: string) {
  // ─── 1. Authentication Check ───────────────────────────────────────────────
  const session = await auth();
  if (!session?.user || !["STAFF", "ADMIN"].includes(session.user.role)) {
    return null;
  }

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

/**
 * Get customer by UUID (Public — for /card/[uuid] route)
 * No authentication required - customers need to view their own cards
 */
export async function getCustomerByUuid(uuid: string) {
  // ─── 1. Input Validation ───────────────────────────────────────────────────
  if (!uuid || typeof uuid !== "string") {
    return null;
  }

  try {
    // ─── 2. Fetch Customer Data ────────────────────────────────────────────────
    const customer = await prisma.customer.findUnique({
      where: { qrUuid: uuid },
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
    console.error("[getCustomerByUuid] Error:", error);
    return null;
  }
}

/**
 * Get customer statistics (for admin dashboard)
 */
export async function getCustomerStats() {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return null;
  }

  try {
    const [totalCustomers, activeCustomers, completedCycles] =
      await Promise.all([
        prisma.customer.count(),
        prisma.customer.count({
          where: {
            orders: {
              some: {
                createdAt: {
                  gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
                },
              },
            },
          },
        }),
        prisma.reward.count({
          where: {
            rule: { isResetPoint: true },
            status: "CLAIMED",
          },
        }),
      ]);

    return {
      totalCustomers,
      activeCustomers,
      completedCycles,
    };
  } catch (error) {
    console.error("[getCustomerStats] Error:", error);
    return null;
  }
}
