import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Both the legacy fork and upstream Komari serve the active theme's
  // `dist/assets/*` through their public SPA fallback at `/assets/*`.
  // Keep this root-relative on purpose: binding assets to `/themes/<short>/`
  // would break installations that rename or repackage the theme, while a
  // relative base would fail from nested SPA routes.
  base: "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    manifest: true,
    target: ["es2020", "safari15.4", "chrome87"],
    rollupOptions: {
      output: {
        // Keep vendor dependencies stable and network-only icons lazy. Priority
        // prevents icon groups from absorbing React or the shared icon factory.
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](?:react|react-dom|react-router|react-router-dom)[\\/]/,
              priority: 40,
            },
            {
              name: "query",
              test: /node_modules[\\/]@tanstack[\\/]react-query[\\/]/,
              priority: 30,
            },
            {
              name: "validation",
              test: /node_modules[\\/]zod[\\/]/,
              priority: 30,
            },
            {
              name: "icon-core",
              test: /lucide-react[\\/]dist[\\/]esm[\\/](?:createLucideIcon|Icon|defaultAttributes|shared[\\/]src[\\/]utils)\.js$/,
              priority: 20,
            },
            {
              name: "network-icons",
              test: /lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/](?:radio|layers-3|file-json|book-open|terminal|globe-2)\.js$/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
});
