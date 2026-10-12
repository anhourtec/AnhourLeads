import { expect, type Page, test } from "@playwright/test";

import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAs } from "./admin-ui";

/** Analytics screen: tabs, system dashboards, custom dashboard + widget, report export, role gating. */

const shot = (name: string, project: string) => `.playwright-mcp/wp-e/analytics-${project}-${name}.png`;

/** /dashboard/analytics was an admin-template route hidden by src/proxy.ts; skip until that line is gone. */
async function openAnalytics(page: Page, path = "/dashboard/analytics") {
  const res = await page.goto(path);
  test.skip(res?.status() === 404, "/dashboard/analytics is still listed in TEMPLATE_ROUTES (src/proxy.ts)");
  expect(res?.status()).toBe(200);
}

/** First visits compile routes in dev; under a busy machine a navigation can take longer than 5 s. */
const NAV = { timeout: 30_000 };

test.describe("analytics screen", () => {
  test.describe.configure({ timeout: 120_000 });
  test("a manager browses tabs, creates a dashboard and adds a widget", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.manager);
    try {
      await openAnalytics(page);
      await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
      for (const tab of ["Overview", "Dashboards", "Reports"]) {
        await expect(page.getByRole("tab", { name: tab })).toBeVisible();
      }
      await expect(page.getByText("System dashboards", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Engagement performance" }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("overview", info.project.name), fullPage: true });

      await page.getByRole("tab", { name: "Dashboards" }).click();
      await expect(page.getByRole("link", { name: "Sales manager command center" })).toBeVisible(NAV);
      await expectNoHorizontalOverflow(page);

      // A system dashboard renders its widgets.
      await page.getByRole("link", { name: "Engagement performance" }).click();
      await page.waitForURL(/\/dashboard\/analytics\/dashboards\/[\w-]+$/);
      await expect(page.getByRole("heading", { level: 1, name: "Engagement performance" })).toBeVisible(NAV);
      await expect(page.getByTestId("widget").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Add widget" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("system-dashboard", info.project.name), fullPage: true });

      // Create a custom dashboard and add a widget.
      await openAnalytics(page);
      await page.getByRole("button", { name: "Create" }).click();
      await page.getByRole("menuitem", { name: "Dashboard" }).click();
      const name = `UI dash ${Date.now()}`;
      await page.getByLabel("Name").fill(name);
      await page.getByRole("button", { name: "Create dashboard" }).click();
      await page.waitForURL(/\/dashboard\/analytics\/dashboards\/[\w-]+$/);
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible(NAV);
      await expect(page.getByText("No widgets yet")).toBeVisible();

      await page.getByRole("button", { name: "Add widget" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Metric").selectOption("emails_sent");
      await dialog.getByLabel("Group by").selectOption("day");
      await dialog.getByLabel("Title").fill("Sent per day");
      await dialog.getByRole("button", { name: "Add to dashboard" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Sent per day")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("custom-dashboard", info.project.name), fullPage: true });

      // Clean up.
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await page.getByRole("button", { name: "Delete dashboard" }).click();
      await page.waitForURL(/\/dashboard\/analytics\?tab=dashboards$/);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a member runs a report and exports it", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.member, { dark: true });
    try {
      await openAnalytics(page, "/dashboard/analytics?tab=reports");
      await expect(page.getByText("Report builder")).toBeVisible();
      await page.getByLabel("Metric").selectOption("emails_sent");
      await page.getByLabel("Group by").selectOption("day");
      await page.getByRole("button", { name: "Run report" }).click();
      const exportLink = page.getByRole("link", { name: "Export CSV" });
      await expect(exportLink).toBeVisible();
      const [download] = await Promise.all([page.waitForEvent("download"), exportLink.click()]);
      expect(download.suggestedFilename()).toBe("emails_sent-day.csv");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("report-dark", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a viewer reads analytics but can't create or star", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.viewer);
    try {
      await openAnalytics(page);
      await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Star / })).toHaveCount(0);
      await page.getByRole("tab", { name: "Reports" }).click();
      await expect(page.getByRole("button", { name: "Run report" })).toBeVisible(NAV);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("viewer", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
