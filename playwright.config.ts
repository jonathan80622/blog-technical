import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.E2E_DATABASE_URL;
if (!databaseUrl) throw new Error("Set E2E_DATABASE_URL to run browser E2E tests.");

/**
 * Browser tests use a disposable PostgreSQL database and the application's real
 * HTTP handlers. Do not add page.route() API stubs here: those are component
 * tests, not end-to-end tests.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
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
      DATABASE_URL: databaseUrl,
      APP_EXECUTION_MODE: "local",
    },
  },
});
