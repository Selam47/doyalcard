// src/lib/auth.config.ts
// EDGE-SAFE half of the NextAuth configuration.
//
// Why this file exists, separately from src/lib/auth.ts:
// middleware.ts runs on the Edge runtime, where bcryptjs (native binary) and
// the pg-backed Prisma client cannot load. Importing "@/lib/auth" there would
// break the build. So the parts middleware actually needs — the JWT session
// strategy and the callbacks that put `role` on the token/session — live here,
// with an EMPTY providers array and no database access of any kind.
//
// src/lib/auth.ts spreads this object and adds the Credentials provider, so
// there is exactly one definition of the session shape. Never add a provider,
// an adapter, bcrypt, or a Prisma import to THIS file.

import type { Session, User } from "next-auth";
import type { JWT } from "next-auth/jwt";

export const authConfig = {
  // No database adapter: with the Credentials provider + JWT sessions,
  // NextAuth never persists users/sessions itself, and the schema has no
  // Account/Session/VerificationToken models for an adapter to use.
  session: { strategy: "jwt" as const },
  pages: {
    signIn: "/login",
  },
  // Deliberately empty here. The real Credentials provider is attached in
  // src/lib/auth.ts, which only ever runs on the Node.js runtime.
  providers: [],
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
