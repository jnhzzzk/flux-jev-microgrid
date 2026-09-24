import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Both values below are public build configuration only. In particular, an
  // API Key must never be supplied through a VITE_* environment variable.
  base: process.env.VITE_BASE_PATH?.trim() || "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: "dist",
  },
});
