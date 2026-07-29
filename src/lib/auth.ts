// src/lib/auth.ts
// Full auth config — used by the /api/auth/[...nextauth] route handler and by
// every Server Action / Server Component that calls auth().
//
// bcryptjs and the pg-backed Prisma client are Node.js-only, so this module
// must NEVER be imported from middleware.ts (Edge runtime). Middleware imports
// the edge-safe half from "@/lib/auth.config" instead — see that file.
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { authConfig } from "@/lib/auth.config";

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Session strategy, pages and the jwt/session callbacks are shared with
  // middleware so the token shape can never drift between the two runtimes.
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: { branch: true },
        });

        if (!user || !user.isActive) return null;

        const isValid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isValid) return null;

        // Best-effort bookkeeping — must never block a successful login.
        try {
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() },
          });
        } catch (err) {
          console.error("[auth] lastLoginAt update failed:", err);
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          branchId: user.branchId,
          branchName: user.branch?.name ?? null,
        };
      },
    }),
  ],
});
