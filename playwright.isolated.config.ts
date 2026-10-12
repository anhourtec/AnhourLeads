import { defineConfig, devices } from "@playwright/test";

/**
 * Screens that need an installation state the shared dev database can't take on without destroying
 * data, such as an empty discovery index while the real crawl lives in `anhourleads`.
 *
 * Runs a second dev server on :43410 against its own database (`anhourleads_isolated`) and Redis
 * database (2), built into `.next-isolated`, so it can run beside `npm run dev`. The database is
 * migrated and seeded from scratch (`--reset --reset-index`) on every run.
 *
 *   npm run test:ui:isolated
 */
export const ISOLATED_PORT = 43410;
export const ISOLATED_URL = `http://localhost:${ISOLATED_PORT}`;
// The session helpers read this when they're imported by the specs.
process.env.TEST_BASE_URL = ISOLATED_URL;

const env = {
  DATABASE_URL:
    process.env.ISOLATED_DATABASE_URL ?? "postgres://anhour:anhour_dev_password@127.0.0.1:48432/anhourleads_isolated",
  REDIS_URL: process.env.ISOLATED_REDIS_URL ?? "redis://:anhour_dev_redis@127.0.0.1:48379/2",
  BETTER_AUTH_URL: ISOLATED_URL,
  APP_PRIMARY_HOSTS: `localhost:${ISOLATED_PORT},127.0.0.1:${ISOLATED_PORT}`,
  NEXT_DIST_DIR: ".next-isolated",
};
process.env.ISOLATED_ENV = JSON.stringify(env);

export default defineConfig({
  testDir: "tests/isolated",
  outputDir: ".playwright-mcp/test-results-isolated",
  globalSetup: "./tests/isolated/global-setup.ts",
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: ".playwright-mcp/report-isolated", open: "never" }]],
  use: { baseURL: ISOLATED_URL, trace: "retain-on-failure" },
  webServer: {
    command: `npx next dev -p ${ISOLATED_PORT}`,
    url: `${ISOLATED_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000,
    env,
  },
  projects: [
    { name: "isolated-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "isolated-tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 834, height: 1112 } } },
    { name: "isolated-mobile", use: { ...devices["Pixel 7"] } },
  ],
});
