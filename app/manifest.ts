import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "G-Sync",
    short_name: "G-Sync",
    description: "Sign in to G-Sync and bring your day together.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#2539a5",
    theme_color: "#2539a5",
    orientation: "portrait",
    lang: "en",
    id: "/",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
