"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

interface Props {
  user: {
    name: string;
    email: string;
    role: string;
    branchName: string | null;
  };
}

export function StaffNav({ user }: Props) {
  const pathname = usePathname();

  const links = [
    { href: "/staff", label: "📷 Tara / Ara", exact: true },
    { href: "/staff/register", label: "➕ Kayıt" },
    ...(user.role === "ADMIN"
      ? [{ href: "/admin", label: "⚙️ Admin" }]
      : []),
  ];

  return (
    <nav className="bg-green-800 text-white shadow-lg">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Brand */}
          <div className="flex items-center gap-2 font-bold text-lg shrink-0">
            <span>🫓</span>
            <span className="hidden sm:inline">ECD</span>
          </div>

          {/* Nav links */}
          <div className="flex items-center gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                  (link.exact ? pathname === link.href : pathname.startsWith(link.href))
                    ? "bg-green-600 text-white"
                    : "text-green-200 hover:text-white hover:bg-green-700"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* User info + logout */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right text-xs">
              <div className="font-semibold">{user.name}</div>
              {user.branchName && (
                <div className="text-green-300">{user.branchName}</div>
              )}
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-xs bg-green-700 hover:bg-green-600 px-2 py-1.5 rounded-lg transition-colors"
            >
              Çıkış
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
