import { Prisma } from "@/generated/prisma/client";

const CONNECTION_ERROR_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);

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
    if (code === "57P03") {
      return true;
    }
  }

  return false;
}
