// prisma.config.ts  (project root)
// Manually load .env so the DATABASE_URL is available when this file is evaluated
import { readFileSync } from "fs";
import { join } from "path";
import { defineConfig } from "prisma/config";

// Parse and inject .env variables before defineConfig runs
try {
  const envPath = join(process.cwd(), ".env");
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = val;
    }
  }
} catch {
  // .env may not exist in production environments — that's fine
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is not set in .env or the environment.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: DATABASE_URL,
  },
});
