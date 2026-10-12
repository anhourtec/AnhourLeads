import { defineConfig, devices } from "@playwright/test";

/**
 * One runner for both harnesses (docs/testing.md):
 *  - `api`: the RBAC + CRUD harness — every endpoint × every role, API keys, cross-tenant isolation.
 *  - `ui-*`: screens at desktop, tablet and mobile widths, light and dark.
 * Needs the docker compose services. The DB is reset and seeded once per run (tests/support/global-setup.ts).
 */
const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3410";

export default defineConfig({
  testDir: "tests",
  outputDir: ".playwright-mcp/test-results",
  globalSetup: "./tests/support/global-setup.ts",
  fullyParallel: false,
  // One shared dev server compiles routes on first hit; under a full parallel run that can take tens of seconds.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 4,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: ".playwright-mcp/report", open: "never" }]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev",
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    { name: "api", testDir: "tests/api" },
    {
      name: "ui-desktop",
      testDir: "tests/ui",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "ui-tablet",
      testDir: "tests/ui",
      use: { ...devices["Desktop Chrome"], viewport: { width: 834, height: 1112 } },
    },
    { name: "ui-mobile", testDir: "tests/ui", use: { ...devices["Pixel 7"] } },
  ],
});
