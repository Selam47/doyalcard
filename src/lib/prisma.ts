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

import { PrismaClient } from "@prisma/client";
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

  // A small pool is enough per serverless function instance — Neon's pooler
  // (PgBouncer) handles the fan-out to the database itself. Setting an
  // explicit connectionTimeoutMillis lets us fail fast (and retry/report
  // clearly) instead of hanging on a cold Neon compute start.
  const pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  });

  pool.on("error", (err) => {
    // Idle clients can emit background errors (e.g. the connection was
    // reset by Neon after a scale-to-zero). Log instead of crashing the
    // process — Prisma will open a new connection on the next query.
    console.error("[prisma] Idle Postgres client error:", err);
  });

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

// ─── Strict global singleton ───────────────────────────────────────────────
// Prevents opening a new connection pool on every hot-reload in dev, and
// on every module re-evaluation between invocations of the same warm
// serverless function in production.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
