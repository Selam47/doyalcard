// src/lib/staff-guard.ts
//
// SINGLE source of truth for "is the caller staff?".
//
// Why this exists instead of inlining `auth()` role checks:
//
//  1. `auth()` only decodes the JWT. The token carries the role that was true
//     at LOGIN time and stays valid for its full lifetime. A staff member who
//     is deactivated (`isActive: false`), demoted from ADMIN to STAFF, or
//     deleted outright keeps every privilege their old token claims until it
//     expires. CLAUDE.md promises that deactivating a user is an immediate
//     lockout — that promise is only true if the role is re-read from the
//     database on every privileged call, which is what this module does.
//
//  2. Server Actions are publicly callable endpoints reachable by their action
//     id. Hiding a button is not a permission check, so every mutation must go
//     through the same guard the page went through.
//
// Fails CLOSED: any lookup error, missing row, inactive row or unexpected role
// resolves to `null` / `{ ok: false }` — never to an authorized principal.
import "server-only";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@/generated/prisma/enums";

/** Roles allowed to operate the till. There is no `CASHIER` — see CLAUDE.md. */
const STAFF_ROLES: readonly Role[] = ["STAFF", "ADMIN"] as const;

export interface StaffPrincipal {
  id: string;
  name: string;
  email: string;
  /** Role as stored in the database RIGHT NOW, not as claimed by the JWT. */
  role: Role;
  branchId: string | null;
  branchName: string | null;
  isAdmin: boolean;
}

export const STAFF_REQUIRED_ERROR = "Yetkisiz erişim: personel girişi gerekli";
export const ADMIN_REQUIRED_ERROR =
  "Yetkisiz erişim: bu işlem yalnızca yöneticiye açıktır";

/**
 * Resolve the current staff principal, or `null` when the caller is not a
 * currently-active STAFF/ADMIN user.
 *
 * Pass this result — never a raw session — to anything that decides what a
 * caller may see or do.
 */
export async function getStaffPrincipal(): Promise<StaffPrincipal | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        branchId: true,
        branch: { select: { name: true } },
      },
    });

    // Deleted between token issue and now, or deactivated since login.
    if (!user || !user.isActive) return null;
    if (!STAFF_ROLES.includes(user.role)) return null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      branchId: user.branchId,
      branchName: user.branch?.name ?? null,
      isAdmin: user.role === "ADMIN",
    };
  } catch (error) {
    // A database hiccup must never be read as "authorized".
    console.error("[staff-guard] principal lookup failed:", error);
    return null;
  }
}

export type StaffGuardResult =
  | { ok: true; staff: StaffPrincipal }
  | { ok: false; error: string };

/**
 * Guard for Server Actions.
 *
 * Returns a discriminated result rather than throwing, per the Server Action
 * error contract in CLAUDE.md §4: a thrown Server Action reaches the client as
 * an opaque digest and surfaces as an unhandled rejection inside
 * `startTransition`, so the cashier would see nothing at all.
 *
 * @param options.adminOnly Require the ADMIN role (destructive operations).
 */
export async function authorizeStaff(
  options: { adminOnly?: boolean } = {}
): Promise<StaffGuardResult> {
  const staff = await getStaffPrincipal();
  if (!staff) return { ok: false, error: STAFF_REQUIRED_ERROR };
  if (options.adminOnly && !staff.isAdmin) {
    return { ok: false, error: ADMIN_REQUIRED_ERROR };
  }
  return { ok: true, staff };
}
