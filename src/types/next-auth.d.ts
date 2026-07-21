// src/types/next-auth.d.ts
import { Role } from "@prisma/client";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      branchId: string | null;
      branchName: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role: Role;
    branchId: string | null;
    branchName: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    branchId: string | null;
    branchName: string | null;
  }
}
