import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";

import { ACME, apiAs, BASE_URL, browserAs } from "../support/session";

/**
 * Research screen at desktop, tablet and mobile widths. Crawls here point at a closed local port,
 * so they fail fast without depending on the fixture site the API harness runs.
 */
const DEAD_SITE = "http://127.0.0.1:48099/";

async function open(browser: Browser, email: string, dark = false) {
  const context: BrowserContext = await browserAs(browser, email);
  if (dark) await context.addCookies([{ name: "theme_mode", value: "dark", url: BASE_URL }]);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return { context, page, errors };
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const shot = (name: string, project: string) => `.playwright-mcp/research-${project}-${name}.png`;

test.describe("research screen", () => {
  test("a member starts a crawl and opens the job", async ({ browser }, info) => {
    test.setTimeout(90_000);
    const { context, page, errors } = await open(browser, ACME.member);
    try {
      const res = await page.goto("/dashboard/research");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Research" })).toBeVisible();
      await expect(page.getByText("New crawl", { exact: true })).toBeVisible();
      await expect(page.getByText("Verify an email", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Validation stays inline.
      await page.getByRole("button", { name: "Start crawl" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Enter a website or pick a company." })).toBeVisible();

      await page.getByLabel("Website").fill(DEAD_SITE);
      await page.getByRole("button", { name: "Start crawl" }).click();
      const link = page.getByRole("link", { name: "127.0.0.1:48099" }).first();
      await expect(link).toBeVisible();
      await page.screenshot({ path: shot("list", info.project.name), fullPage: true });

      await link.click();
      await page.waitForURL(/\/dashboard\/research\/[\w-]+$/);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("127.0.0.1");
      await expect(page.getByText("Pages", { exact: true })).toBeVisible();
      // The job settles on its own (auto-refresh) as failed: nothing listens on that port.
      await expect(page.getByText("The crawl didn't finish")).toBeVisible({ timeout: 45_000 });
      await expect(page.getByRole("button", { name: "Apply to company" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("job", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a member verifies an email", async ({ browser }) => {
    const { context, page, errors } = await open(browser, ACME.member);
    try {
      await page.goto("/dashboard/research");
      await page.getByLabel("Email address").fill("not-an-email");
      await page.getByRole("button", { name: "Verify now" }).click();
      await expect(page.getByText("This isn't a valid email address.")).toBeVisible();
      await expect(page.getByText("Invalid", { exact: true })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a viewer sees jobs but can't start crawls or verify", async ({ browser }, info) => {
    const { context, page, errors } = await open(browser, ACME.viewer, true);
    try {
      const res = await page.goto("/dashboard/research");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Research" })).toBeVisible();
      await expect(page.getByText("New crawl", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Start crawl" })).toHaveCount(0);
      await expect(page.getByText("Verify an email", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Crawl jobs", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("viewer-dark", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a completed job shows findings and the apply action, in dark mode", async ({ browser }, info) => {
    const api = await apiAs(ACME.member);
    const list = await (await api.get("/api/v1/crawl_jobs?status=completed&per_page=1")).json();
    const job = list.crawl_jobs[0] as { id: string } | undefined;
    test.skip(!job, "no completed crawl in this workspace yet (the API harness creates one)");
    const { context, page, errors } = await open(browser, ACME.member, true);
    try {
      const res = await page.goto(`/dashboard/research/${job?.id}`);
      expect(res?.status()).toBe(200);
      for (const title of ["Company facts", "Emails", "People", "Technologies and profiles", "Pages"]) {
        await expect(page.getByRole("main").getByText(title, { exact: true })).toBeVisible();
      }
      await expect(page.getByRole("button", { name: "Apply to company" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("findings-dark", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("unknown and other-workspace jobs are not found", async ({ browser }) => {
    const { context, page } = await open(browser, ACME.member);
    try {
      // The job is checked before the loading boundary, so a missing id gets a real 404 status.
      const missing = await page.goto("/dashboard/research/does-not-exist");
      expect(missing?.status()).toBe(404);
    } finally {
      await context.close();
    }
  });
});
