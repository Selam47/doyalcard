// src/lib/auth.ts
// Full auth config — used by the /api/auth/[...nextauth] route handler.
// bcryptjs is Node.js-only, so the /api/auth route must stay on Node runtime.
import NextAuth from "next-auth";
import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const authConfig = {
  // No database adapter: with the Credentials provider + JWT sessions,
  // NextAuth never persists users/sessions itself, and the schema has no
  // Account/Session/VerificationToken models for an adapter to use.
  session: { strategy: "jwt" as const },
  pages: {
    signIn: "/login",
  },
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
  callbacks: {
    async jwt({ token, user }: { token: JWT; user?: User }) {
      if (user && user.id) {
        token.id = user.id;
        token.role = user.role;
        token.branchId = user.branchId;
        token.branchName = user.branchName;
      }
      return token;
    },
    async session({ session, token }: { session: Session; token: JWT }) {
      if (token && session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.branchId = token.branchId;
        session.user.branchName = token.branchName;
      }
      return session;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);

