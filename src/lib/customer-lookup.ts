// src/lib/customer-lookup.ts
//
// THE one way to turn a raw, human-typed phone number into a Customer row.
//
// Every phone-keyed surface funnels through here:
//
//   • searchCustomerByPhone()        → staff terminal search (full row)
//   • /api/customer/exists           → the customer login screen's pre-OTP
//                                      "do I have an account?" check (boolean only)
//
// Why this module exists at all: a lookup is only ever as correct as the
// agreement between the string that was STORED and the string being searched
// for. `normalizePhoneToE164` already guarantees one spelling per human, but
// the *second* half of the contract — "normalize, then ask for exactly that one
// row on the UNIQUE column, never a `contains`, never a `findFirst`" — was
// previously written out per call site. The staff search regressed to a
// `findFirst({ contains })` once already and handed a cashier the WRONG
// PERSON's card. Encoding the whole shape once removes the opportunity.
//
// ─── Deliberately NOT a "use server" file ────────────────────────────────────
// Same reasoning as src/lib/card-access.ts: every export of a "use server"
// module is a publicly callable endpoint reachable by its action id. A raw
// "does this phone number exist?" oracle must not be reachable that way — the
// only public door is the rate-limited route handler, which returns a bare
// boolean and nothing else.
import "server-only";

import { prisma } from "@/lib/prisma";
import { normalizePhoneToE164 } from "@/lib/phone";
import { isDbConnectionError } from "@/lib/db-errors";

/**
 * Why this is not just `T | null`.
 *
 * "No such customer" and "I could not tell" are completely different answers
 * and the login screen has to be able to distinguish them: the first shows the
 * "Kayıt Ol" screen, the second must show a real error. Collapsing a database
 * timeout into `null` is exactly how a registered customer would be told their
 * account does not exist and be invited to create a second one.
 */
export type CustomerPhoneLookup<T> =
  /** Normalized fine, row found. */
  | { status: "found"; phone: string; customer: T }
  /** Normalized fine, no row carries that number. */
  | { status: "not-found"; phone: string }
  /** The input could not be resolved to a valid E.164 number at all. */
  | { status: "invalid-phone" }
  /** The database could not answer. NEVER report this as "not-found". */
  | { status: "error"; transient: boolean };

/**
 * Shared core: normalize, then hand the caller's own projection the ONE row
 * that can carry that number.
 *
 * The finder is passed in rather than a Prisma `select` object so each caller
 * keeps its own precisely-typed projection (the staff terminal needs rewards
 * and branch; the public existence check must see nothing but an id) while the
 * normalize / exact-match / error-classification logic stays in one place.
 */
async function runPhoneLookup<T>(
  rawPhone: unknown,
  find: (normalizedPhone: string) => Promise<T | null>,
  label: string
): Promise<CustomerPhoneLookup<T>> {
  if (typeof rawPhone !== "string" || rawPhone.trim() === "") {
    return { status: "invalid-phone" };
  }

  // The canonical normalizer. It returns null rather than a plausible-looking
  // wrong answer, so a half-typed number can never become a searchable one.
  const normalized = normalizePhoneToE164(rawPhone);
  if (!normalized) return { status: "invalid-phone" };

  try {
    const customer = await find(normalized);
    return customer
      ? { status: "found", phone: normalized, customer }
      : { status: "not-found", phone: normalized };
  } catch (error) {
    console.error(`[${label}] phone lookup failed:`, error);
    return { status: "error", transient: isDbConnectionError(error) };
  }
}

/**
 * Existence only — the projection is a single `id` and the caller (the public
 * route) narrows even that to a boolean.
 *
 * `phone` is UNIQUE, so `findUnique` on the normalized string provably returns
 * the number that was typed, or nothing at all.
 */
export async function lookupCustomerIdByPhone(
  rawPhone: unknown
): Promise<CustomerPhoneLookup<{ id: string }>> {
  return runPhoneLookup(
    rawPhone,
    (phone) =>
      prisma.customer.findUnique({
        where: { phone },
        select: { id: true },
      }),
    "customer-lookup"
  );
}

/**
 * The full row the staff terminal renders. Only ever reached behind
 * `authorizeStaff()` in src/actions/customer.ts — this module grants nothing on
 * its own.
 */
export async function lookupCustomerForStaffByPhone(rawPhone: unknown) {
  return runPhoneLookup(
    rawPhone,
    (phone) =>
      prisma.customer.findUnique({
        where: { phone },
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
            where: { status: "PENDING" as const },
            include: { rule: true },
            orderBy: { createdAt: "desc" as const },
          },
        },
      }),
    "searchCustomerByPhone"
  );
}
