/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // VITE_PORT keeps the Playwright dev server off the machine's winnat-reserved 5141-5240 range (5173 is inside it, so binding it fails EACCES).
  // Proxy /api only in live mode so mock-mode dev/Playwright stay untouched (VITE_API_URL defaults to the brief's 3000).
  server: {
    host: "127.0.0.1",
    port: Number(process.env.VITE_PORT ?? 5241),
    strictPort: true,
    proxy: process.env.VITE_USE_MOCK === "true"
      ? undefined
      : { "/api": { target: process.env.VITE_API_URL ?? "http://127.0.0.1:3000", changeOrigin: false } },
  },
  test: { environment: "jsdom", setupFiles: ["test/setup.ts"], include: ["test/**/*.test.{ts,tsx}"] },
});
