// src/app/staff/layout.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { StaffNav } from "@/components/staff/StaffNav";

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["STAFF", "ADMIN"].includes(session.user.role)) redirect("/");

  return (
    <div className="min-h-screen bg-gray-50">
      <StaffNav
        user={{
          name: session.user.name ?? "",
          email: session.user.email ?? "",
          role: session.user.role,
          branchName: session.user.branchName ?? null,
        }}
      />
      <main className="max-w-4xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
