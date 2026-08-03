import { redirect } from "next/navigation";

import { getStaffPrincipal } from "@/lib/staff-guard";
import { StaffNav } from "@/components/staff/StaffNav";

/**
 * Gate on the DATABASE-backed principal, never on `auth()` / `session.user.role`.
 *
 * The JWT carries the role that was true at LOGIN time and stays valid for its
 * full lifetime, so a staff member who was deactivated (`isActive: false`),
 * demoted or deleted would keep rendering this entire shell — nav, links to the
 * till, every child page — until the token expired. `getStaffPrincipal()`
 * re-reads the `users` row on every request and fails CLOSED, which is what
 * makes the "deactivating a user is an immediate lockout" promise in CLAUDE.md
 * actually true for the page surface and not just for the Server Actions.
 *
 * The middleware check stays JWT-only on purpose: it runs on the Edge runtime,
 * which cannot reach the `pg`-backed Prisma client. Middleware is defence in
 * depth; THIS is the authoritative page-level check.
 */
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staff = await getStaffPrincipal();
  if (!staff) redirect("/login");

  return (
    <div className="min-h-screen bg-gray-50">
      <StaffNav
        user={{
          name: staff.name,
          email: staff.email,
          role: staff.role,
          branchName: staff.branchName,
        }}
      />
      <main className="max-w-4xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
