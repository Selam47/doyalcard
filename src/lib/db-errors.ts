// src/lib/db-errors.ts
// Shared helper for recognizing database connectivity/timeout failures —
// most commonly a Neon "cold start" (compute scaled to zero and the first
// query has to wait for it to wake up) — so API routes and server actions
// can return a distinct, retryable error instead of a generic 500.
import { Prisma } from "@prisma/client";

// Prisma error codes that indicate a connection/availability problem rather
// than a query/data problem:
//  P1001 – Can't reach database server
//  P1002 – Database server was reached but timed out
//  P1008 – Operations timed out
//  P1017 – Server has closed the connection
const CONNECTION_ERROR_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);

// node-postgres / TCP-level error codes for the same class of failure.
const CONNECTION_ERROR_NAMES = new Set([
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
]);

export function isDbConnectionError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    CONNECTION_ERROR_CODES.has(err.code)
  ) {
    return true;
  }

  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    if (code && CONNECTION_ERROR_NAMES.has(code)) {
      return true;
    }
    // Postgres' own "cannot_connect_now" SQLSTATE, surfaced while Neon is
    // still spinning the compute back up.
    if (code === "57P03") {
      return true;
    }
  }

  return false;
}
