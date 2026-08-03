import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [],
  },
  serverExternalPackages: ["@prisma/client", "bcryptjs", "pg"],
  async headers() {
    return [
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/:file(favicon.ico|apple-touch-icon.png|android-chrome-192x192.png|android-chrome-512x512.png|favicon-16x16.png|favicon-32x32.png)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
