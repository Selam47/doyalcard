"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { cn } from "@/lib/utils";

interface Props {
  user: { name: string; email: string };
}

const links = [
  { href: "/admin", label: "📊 Dashboard", exact: true },
  { href: "/admin/rules", label: "🎯 Kurallar" },
  { href: "/admin/branches", label: "🏪 Şubeler" },
  { href: "/admin/staff", label: "👥 Personel" },
  { href: "/staff", label: "⬅ Personel" },
];

export function AdminNav({ user }: Props) {
  const pathname = usePathname();

  return (
    <nav className="bg-gray-900 text-white shadow-lg">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-2 font-bold shrink-0">
            <span>⚙️</span>
            <span className="hidden sm:inline text-sm">Admin Panel</span>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap",
                  (link.exact ? pathname === link.href : pathname.startsWith(link.href))
                    ? "bg-gray-700 text-white"
                    : "text-gray-400 hover:text-white hover:bg-gray-800"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-gray-400 hidden sm:block">{user.name}</span>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1.5 rounded-lg"
            >
              Çıkış
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
}
