import { expect, test } from "@playwright/test";

import { uniq } from "../api/_engage";
import { insertCompany, insertPerson } from "../api/_wp-e-enrichment";
import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAs } from "./admin-ui";

/** Data enrichment screen at desktop, tablet and mobile: tabs, CSV flow, merge, role gating. */

test.describe.configure({ timeout: 120_000 });

const shot = (name: string, project: string) => `.playwright-mcp/wp-e/enrichment-${project}-${name}.png`;

test.describe("data enrichment screen", () => {
  test("a member sees the health center and enriches a CSV", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.member);
    try {
      const res = await page.goto("/dashboard/enrichment");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Data enrichment" })).toBeVisible();
      for (const tab of ["Data health center", "CSV", "Job changes", "Research"]) {
        await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`) })).toBeVisible();
      }
      await expect(page.getByText("Contacts missing an email")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Enrich now/ }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /View scheduled jobs/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "Automate enrichment" })).toBeVisible();
      await expect(page.getByText("Enrichment activity")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("health", info.project.name), fullPage: true });

      await page.getByRole("tab", { name: "CSV" }).click();
      await expect(page).toHaveURL(/tab=csv/);
      await page.getByRole("button", { name: "Enrich CSV" }).click();
      await expect(page.getByText("Choose a CSV file first.")).toBeVisible();
      await page.getByLabel("CSV file").setInputFiles({
        name: `ui-${info.project.name}.csv`,
        mimeType: "text/csv",
        buffer: Buffer.from("name,email\nThrow Away,x@mailinator.com\nBad Address,not-an-email\n"),
      });
      await expect(page.getByText(/2 rows · recognised/)).toBeVisible();
      await page.getByRole("button", { name: "Enrich CSV" }).click();
      await expect(page.getByRole("link", { name: "Download enriched CSV" })).toBeVisible({ timeout: 60_000 });
      const results = page.getByRole("table");
      await expect(results.getByText("x@mailinator.com")).toBeVisible();
      await expect(results.getByText("Disposable", { exact: true })).toBeVisible();
      await expect(results.getByText("Invalid", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("csv", info.project.name), fullPage: true });

      await page.getByRole("tab", { name: /^Job changes/ }).click();
      await expect(page.getByText("Possible job changes")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole("tab", { name: "Research" }).click();
      await expect(page.getByRole("link", { name: "Open research" })).toBeVisible();

      await page.getByRole("button", { name: /View scheduled jobs/ }).click();
      await expect(page.getByRole("dialog").getByText("Scheduled jobs", { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a manager merges duplicates from the health center", async ({ browser }, info) => {
    const tag = uniq("uidup");
    const companyId = await insertCompany("acme", { name: `UI Dup ${tag}` });
    const rich = `Rich ${tag}`;
    await insertPerson("acme", {
      firstName: "Merge",
      lastName: tag,
      companyId,
      title: rich,
      email: `${tag}@ui-dup.test`,
    });
    await insertPerson("acme", { firstName: "Merge", lastName: tag, companyId });

    const { context, page, errors } = await openAs(browser, ACME.manager);
    try {
      await page.goto("/dashboard/enrichment");
      const group = page
        .locator("li")
        .filter({ has: page.getByRole("button", { name: "Merge" }) })
        .filter({ hasText: `${tag}@ui-dup.test` });
      await expect(group).toHaveCount(1);
      await group.getByRole("button", { name: "Merge" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toContainText("is kept because it has the most filled fields");
      await page.screenshot({ path: shot("merge-dialog", info.project.name) });
      await dialog.getByRole("button", { name: "Merge" }).click();
      await expect(page.getByText(/^Merged into/)).toBeVisible({ timeout: 30_000 });
      await expect(group).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("an admin saves an automation schedule", async ({ browser }) => {
    const { context, page, errors } = await openAs(browser, ACME.admin);
    try {
      await page.goto("/dashboard/enrichment");
      await page.getByRole("button", { name: "Automate enrichment" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("Run every (days)")).toBeDisabled();
      await dialog.getByLabel("Scheduled enrichment").click();
      await dialog.getByLabel("Run every (days)").fill("0");
      await dialog.getByRole("button", { name: "Save schedule" }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await dialog.getByLabel("Run every (days)").fill("30");
      await dialog.getByRole("button", { name: "Save schedule" }).click();
      await expect(page.getByText("Scheduled enrichment is on.")).toBeVisible();
      // Leave it off for the rest of the suite.
      await page.getByRole("button", { name: "Automate enrichment" }).click();
      await page.getByRole("dialog").getByLabel("Scheduled enrichment").click();
      await page.getByRole("dialog").getByRole("button", { name: "Save schedule" }).click();
      await expect(page.getByText("Scheduled enrichment is off.")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a viewer gets a read-only screen, in dark mode", async ({ browser }, info) => {
    const { context, page, errors } = await openAs(browser, ACME.viewer, { dark: true });
    try {
      const res = await page.goto("/dashboard/enrichment");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Data enrichment" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Enrich now/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Merge" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Automate enrichment" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /View scheduled jobs/ })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("viewer-dark", info.project.name), fullPage: true });
      await page.getByRole("tab", { name: "CSV" }).click();
      await expect(page.getByRole("button", { name: "Enrich CSV" })).toHaveCount(0);
      await expect(page.getByText("Your role can't start new ones.")).toBeVisible();
      await page.getByRole("tab", { name: /^Job changes/ }).click();
      await expect(page.getByRole("button", { name: "Mark as changed job" })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
