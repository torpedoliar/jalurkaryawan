import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // one worker: every test mutates the in-memory mock DB, and a shared worker means a shared page
  reporter: "list",
  // 5241, not the usual 5173: this machine's winnat has reserved TCP 5141-5240, so binding 5173 fails with EACCES on every loopback address.
  use: {
    baseURL: "http://127.0.0.1:5241",
    trace: "retain-on-failure",
    // VITE_USE_MOCK drives main.tsx's dynamic import of msw/browser, so the browser talks to the same mock as vitest.
  },
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:5241",
    reuseExistingServer: !process.env.CI,
    // Inherit VITE_USE_MOCK from the shell (test:api sets false) so live-mode e2e can reuse this webServer block.
    env: { VITE_USE_MOCK: process.env.VITE_USE_MOCK ?? "true", VITE_PORT: "5241", VITE_DEMO_PROFILE: "legacy" },
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
