// src/lib/prisma.ts
// Standard Node.js Prisma setup for Vercel serverless functions talking to
// Neon Postgres. Uses node-postgres (`pg`) via `@prisma/adapter-pg` against
// Neon's pooled connection string (DATABASE_URL) — no edge/WebSocket driver,
// no Cloudflare-specific code. Migrations run separately against the direct
// (non-pooled) DIRECT_URL, see prisma.config.ts.
//
// `server-only` makes any accidental import from a Client Component fail
// loudly at build time instead of silently pulling `pg` (which needs Node's
// `tls`/`net`) into the Webpack client bundle.
import "server-only";

import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL environment variable is not set. " +
        "Make sure .env.local exists with DATABASE_URL defined."
    );
  }

  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  pool.on("error", (err) => {
    console.error("[prisma] Idle Postgres client error:", err);
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
