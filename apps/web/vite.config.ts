import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  envDir: path.resolve(__dirname, "../.."),
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Collaborative Ledger",
        short_name: "Ledger",
        description: "Shared customer ledger for small businesses",
        theme_color: "#0b3b2e",
        background_color: "#f2f5f3",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/health"),
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
