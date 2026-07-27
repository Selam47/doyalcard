import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Doyalcard — Dijital Sadakat Kartı",
    short_name: "Doyalcard",
    description: "QR Kodlu Dijital Sadakat Kartı ve Kampanya Yönetim Sistemi",
    start_url: "/",
    display: "standalone",
    background_color: "#0B2B1B",
    theme_color: "#0B2B1B",
    lang: "tr",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
