// src/app/admin/layout.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/staff");

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminNav user={{ name: session.user.name ?? "", email: session.user.email ?? "" }} />
      <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
