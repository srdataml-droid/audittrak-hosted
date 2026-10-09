import { defineConfig } from "vite";
export default defineConfig({
  root: "ui",
  base: "/",
  build: {
    outDir: "../public/app",
    emptyOutDir: true,
    assetsDir: "app-assets",
  },
  server: { proxy: { "/api": "http://localhost:3000" } },
});
