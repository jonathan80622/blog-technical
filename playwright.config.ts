import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests mock API routes to verify the UI's request and visibility
 * contract. They do not execute or prove the behavior of the server handlers.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3187",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3187",
    url: "http://127.0.0.1:3187",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/blog_technical",
    },
  },
});
