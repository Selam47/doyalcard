// src/lib/card-access.ts
//
// Card loaders for a customer stamp card, keyed on the public `qrUuid`.
//
// Two loaders, two very different surfaces — keep them apart:
//
//   • resolvePublicCardAccess()  → /card/[uuid], the PUBLIC read-only card.
//     Deliberately takes NO session of any kind. The UUID *is* the credential:
//     a customer scans the QR printed on their own card with a raw phone
//     camera, which opens a fresh tab with no cookies, and they must land on
//     their card immediately. Requiring a login here breaks the one flow the
//     whole product exists for.
//
//   • resolveStaffCardAccess()   → /staff/customer/[uuid], the ACTION surface.
//     Requires an active STAFF/ADMIN principal, re-read from the database.
//
// What keeps the public loader safe is not authentication but its shape:
//   - `qrUuid` is a v4 UUID (122 bits of entropy) and is never enumerated,
//     listed, or searchable — there is no route that returns more than the one
//     card the caller already named.
//   - The projection below is fixed and narrow. It must NEVER grow to include
//     a raw phone number, an email, an address or an internal id beyond what
//     the card itself displays; the phone is masked at render time by
//     CustomerCardView. Adding a field here widens what a leaked QR photo
//     discloses, so treat CARD_SELECT as the privacy boundary.
//   - The public route renders zero mutations, so read access confers nothing.
//
// This module deliberately is NOT a "use server" file: the query below must
// not become a publicly callable Server Action endpoint.
import "server-only";

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { getStaffPrincipal, type StaffPrincipal } from "@/lib/staff-guard";

/**
 * `Customer.qrUuid` is `@db.Uuid`, so anything that is not a UUID can never
 * match a row — and handing Postgres a malformed uuid literal raises instead
 * of returning empty. Screening here turns that into a clean 404.
 */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    /*
     * PENDING FIRST, then newest — and the order of these two keys matters.
     *
     * This relation used to be unbounded, which made the hottest read in the
     * app (/card/[uuid], /customer/dashboard, /staff/customer/[uuid]) grow
     * without limit for a regular customer. It is bounded now, but a naive
     * `orderBy: { createdAt: "desc" }, take: N` would have been WORSE than the
     * problem it fixed: `pendingRewards` is derived by FILTERING this array
     * (CustomerCardView.tsx, and staff/customer/[uuid]/page.tsx which feeds
     * StaffActionPanel's claim list), so an old unclaimed reward that fell out
     * of the newest-N window would silently become unclaimable at the till —
     * the customer earned it, and the cashier simply could not see it.
     *
     * Sorting on `status` first prevents that structurally. `RewardStatus` is
     * declared PENDING, CLAIMED, EXPIRED (prisma/schema.prisma) and Postgres
     * orders enum values by DECLARATION order, so ascending puts every PENDING
     * ahead of every CLAIMED/EXPIRED. The `take` can therefore only ever
     * truncate old claimed history — never something still owed to a customer.
     *
     * ⚠ Reordering the RewardStatus enum, or inserting a value before PENDING
     * with ALTER TYPE ... BEFORE, silently breaks that guarantee.
     *
     * Backed by @@index([customerId, status]). The UI already shows only
     * `claimedRewards.slice(0, 3)`, so nothing visible is lost.
     */
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 50,
    include: {
      rule: true,
      order: { select: { createdAt: true } },
    },
  },
  // `satisfies`, not `as const`: the multi-key `orderBy` above is an array, and
  // `as const` would make it `readonly`, which Prisma's generated input types
  // reject. `satisfies` still validates every key against the real schema and
  // still preserves the literal types that `CardCustomer` is inferred from.
} satisfies Prisma.CustomerSelect;

async function findCardCustomer(uuid: string) {
  return prisma.customer.findUnique({
    where: { qrUuid: uuid },
    select: CARD_SELECT,
  });
}

export type CardCustomer = NonNullable<
  Awaited<ReturnType<typeof findCardCustomer>>
>;

export type PublicCardAccess =
  /** UUID is malformed or does not resolve to a customer. */
  | { status: "not-found" }
  /** The card exists. There is no other outcome — this surface is public. */
  | { status: "ok"; customer: CardCustomer };

/**
 * Load the card behind `/card/<uuid>` for ANY visitor.
 *
 * There is intentionally no session read here and no `unauthenticated` or
 * `forbidden` state to return. A raw camera scan of the customer's own QR code
 * opens a cookie-less tab, and that scan must render the card. Do not add a
 * session check, a role branch, or a redirect to this function — if you find
 * yourself wanting one, you are probably looking for resolveStaffCardAccess().
 *
 * This returns READ data only. It confers no right to mutate anything: the
 * public route renders no action, and every mutation elsewhere independently
 * re-runs `authorizeStaff()`.
 */
export async function resolvePublicCardAccess(
  uuid: string
): Promise<PublicCardAccess> {
  if (!uuid || typeof uuid !== "string") return { status: "not-found" };

  // Cheap shape check before hitting the database. A scanner or a crawler that
  // sends garbage should cost us nothing, and a non-UUID can never match.
  if (!UUID_PATTERN.test(uuid)) return { status: "not-found" };

  let customer: CardCustomer | null;
  try {
    customer = await findCardCustomer(uuid);
  } catch (error) {
    console.error("[card-access] public customer lookup failed:", error);
    return { status: "not-found" };
  }

  if (!customer) return { status: "not-found" };

  return { status: "ok", customer };
}

/**
 * Staff-terminal loader for /staff/customer/[uuid].
 *
 * Separate from resolvePublicCardAccess() because this surface has no customer
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
  if (!UUID_PATTERN.test(uuid)) return { status: "not-found" };

  try {
    const customer = await findCardCustomer(uuid);
    if (!customer) return { status: "not-found" };
    return { status: "ok", customer, staff };
  } catch (error) {
    console.error("[card-access] staff customer lookup failed:", error);
    return { status: "not-found" };
  }
}
