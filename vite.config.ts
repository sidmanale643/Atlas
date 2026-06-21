import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const root = dirname(fileURLToPath(import.meta.url));

// The 3D brain (web/src/viz/brain/*) is copied verbatim from the legacy app and
// still imports Three.js addons via the CDN-style "three/addons/" specifier.
// Re-point that to the npm package's examples path so the brain code is unchanged.
export default defineConfig({
  root: resolve(root, "web"),
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^three\/addons\//, replacement: "three/examples/jsm/" },
    ],
  },
  build: {
    outDir: resolve(root, "public/app"),
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:3001",
      "/assets": "http://localhost:3001",
      "/fonts": "http://localhost:3001",
    },
  },
});
