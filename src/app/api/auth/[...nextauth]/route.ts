// src/app/api/auth/[...nextauth]/route.ts
// Next.js 16 requires explicit GET/POST handler signatures.
import { handlers } from "@/lib/auth";
import type { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  return handlers.GET(req);
}

export async function POST(req: NextRequest) {
  return handlers.POST(req);
}
