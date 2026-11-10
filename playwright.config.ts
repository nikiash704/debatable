import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the real Worker + Durable Objects (workerd via `vite preview`).
 * Set E2E_BASE_URL to reuse a running server (for example `npm run dev` on :5173).
 */
const external = process.env.E2E_BASE_URL;
const port = 4173;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: external ?? `http://localhost:${port}`,
    trace: "off",
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: external
    ? undefined
    : {
        command: `npx vite build && npx vite preview --port ${port} --strictPort`,
        url: `http://localhost:${port}/api/health`,
        timeout: 180_000,
        reuseExistingServer: true,
      },
});
