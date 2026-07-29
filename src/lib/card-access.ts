// src/lib/card-access.ts
//
// Access control for a customer stamp card, keyed on the public `qrUuid`.
//
// Knowing a UUID is no longer sufficient to read a card. A card discloses a
// real person's name, masked phone, order history and reward history — KVKK
// personal data — so the viewer must be either:
//
//   • an active STAFF/ADMIN user (full read, plus the separate staff terminal
//     at /staff/customer/[uuid] for actions), or
//   • the customer themselves, proven by the customer session cookie matching
//     the card's own customer id.
//
// Anonymous callers are rejected BEFORE the database is touched, so the route
// cannot be used to probe which UUIDs exist.
//
// This module deliberately is NOT a "use server" file: the query below must
// not become a publicly callable Server Action endpoint.
import "server-only";

import { prisma } from "@/lib/prisma";
import { getCustomerSession } from "@/lib/customer-session";
import { getStaffPrincipal, type StaffPrincipal } from "@/lib/staff-guard";

const CARD_SELECT = {
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
} as const;

async function findCardCustomer(uuid: string) {
  return prisma.customer.findUnique({
    where: { qrUuid: uuid },
    select: CARD_SELECT,
  });
}

export type CardCustomer = NonNullable<
  Awaited<ReturnType<typeof findCardCustomer>>
>;

export type CardAccess =
  /** No staff session and no customer session — send to login. */
  | { status: "unauthenticated" }
  /** Signed in, but this card belongs to somebody else. */
  | { status: "forbidden" }
  /** UUID does not resolve to a customer (only reachable once authenticated). */
  | { status: "not-found" }
  /** Authorized. `staff` is non-null only for an active STAFF/ADMIN viewer. */
  | { status: "ok"; customer: CardCustomer; staff: StaffPrincipal | null };

/**
 * Resolve who is asking for `/card/<uuid>` and whether they may see it.
 *
 * Note this returns read authorization ONLY. It never confers the right to
 * mutate anything — every mutation re-runs `authorizeStaff()` on its own.
 */
export async function resolveCardAccess(uuid: string): Promise<CardAccess> {
  if (!uuid || typeof uuid !== "string") {
    return { status: "unauthenticated" };
  }

  const [staff, customerSession] = await Promise.all([
    getStaffPrincipal(),
    getCustomerSession(),
  ]);

  // Reject anonymous callers before any lookup: a 404-vs-redirect difference
  // would otherwise confirm whether a guessed UUID belongs to a real customer.
  if (!staff && !customerSession) return { status: "unauthenticated" };

  let customer: CardCustomer | null;
  try {
    customer = await findCardCustomer(uuid);
  } catch (error) {
    console.error("[card-access] customer lookup failed:", error);
    return { status: "not-found" };
  }

  if (!customer) return { status: "not-found" };

  // Staff may read any card (they need to at the counter).
  if (staff) return { status: "ok", customer, staff };

  // A customer may read exactly one card: their own.
  if (customerSession?.customerId !== customer.id) {
    return { status: "forbidden" };
  }

  return { status: "ok", customer, staff: null };
}

/**
 * Staff-terminal loader for /staff/customer/[uuid].
 *
 * Separate from resolveCardAccess() because this surface has no customer
 * fallback at all — a customer session must NEVER satisfy it.
 */
export async function resolveStaffCardAccess(uuid: string): Promise<
  | { status: "unauthorized" }
  | { status: "not-found" }
  | { status: "ok"; customer: CardCustomer; staff: StaffPrincipal }
> {
  const staff = await getStaffPrincipal();
  if (!staff) return { status: "unauthorized" };

  if (!uuid || typeof uuid !== "string") return { status: "not-found" };

  try {
    const customer = await findCardCustomer(uuid);
    if (!customer) return { status: "not-found" };
    return { status: "ok", customer, staff };
  } catch (error) {
    console.error("[card-access] staff customer lookup failed:", error);
    return { status: "not-found" };
  }
}
