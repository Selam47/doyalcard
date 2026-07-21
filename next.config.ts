import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow next/image from any domain if needed in future
  images: {
    remotePatterns: [],
  },
  // Suppress known Prisma warnings in Next.js edge
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
};

export default nextConfig;
