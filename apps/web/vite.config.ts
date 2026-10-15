/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // VITE_PORT keeps the Playwright dev server off the machine's winnat-reserved 5141-5240 range (5173 is inside it, so binding it fails EACCES).
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 5173, strictPort: true },
  test: { environment: "jsdom", setupFiles: ["test/setup.ts"], include: ["test/**/*.test.{ts,tsx}"] },
});
