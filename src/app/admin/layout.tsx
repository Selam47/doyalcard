import { redirect } from "next/navigation";

import { getStaffPrincipal } from "@/lib/staff-guard";
import { AdminNav } from "@/components/admin/AdminNav";

/**
 * Same rule as the staff layout: the ADMIN check is re-read from the database
 * on every request, not taken from the JWT.
 *
 * An ADMIN demoted to STAFF keeps `role: "ADMIN"` in their token until it
 * expires; gating on that would leave the admin panel open to them long after
 * the demotion. A caller with a valid but non-admin principal is sent to
 * /staff (the highest surface they may still see); a caller with no valid
 * principal at all is sent to /login.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const staff = await getStaffPrincipal();
  if (!staff) redirect("/login");
  if (!staff.isAdmin) redirect("/staff");

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNav user={{ name: staff.name, email: staff.email }} />
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
