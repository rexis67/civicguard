import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiTarget = process.env.VITE_DEV_API_TARGET ?? "http://localhost:5000";

export default defineConfig(({ command }) => {
  // Express rewrites this placeholder at request time using a trusted public
  // origin. When building a split static frontend, set PUBLIC_SITE_URL so the
  // absolute canonical/Open Graph URLs are baked in instead.
  const configuredOrigin = (process.env.PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  const publicOrigin =
    configuredOrigin || (command === "serve" ? "http://localhost:5173" : "");

  return {
    plugins: [
      react(),
      {
        name: "civicguard-public-origin",
        transformIndexHtml(html) {
          return publicOrigin
            ? html.replaceAll("__PUBLIC_ORIGIN__", publicOrigin)
            : html;
        },
      },
    ],
    server: {
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
        "/uploads": { target: apiTarget, changeOrigin: true },
      },
    },
  };
});
