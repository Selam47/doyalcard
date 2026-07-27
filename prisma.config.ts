// prisma.config.ts  (project root)
// Config for Prisma CLI commands (migrate, db push, studio, seed).
// Runtime query connections are configured separately in src/lib/prisma.ts.
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma CLI commands need a direct — i.e. non-pooled — connection to Neon:
// PgBouncer's transaction pooling mode doesn't support the session-level
// advisory locks Prisma Migrate uses. Runtime queries (via src/lib/prisma.ts)
// go through the pooled DATABASE_URL instead.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
