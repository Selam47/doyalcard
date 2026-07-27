import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow next/image from any domain if needed in future
  images: {
    remotePatterns: [],
  },
  // Keep these packages external to the Next.js server bundle so their
  // native/binary internals (Prisma's query engine, bcryptjs) work correctly
  // in Vercel's Node.js serverless functions.
  serverExternalPackages: ["@prisma/client", "bcryptjs", "pg"],
};

export default nextConfig;
