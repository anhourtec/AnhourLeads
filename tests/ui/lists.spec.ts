import { expect as baseExpect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, runId, shot, signedInPage } from "./_engage-ui";

// The shared dev server recompiles while other work is edited; allow for slow responses.
test.describe.configure({ timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

test.describe("lists screens", () => {
  test("a member creates a list and opens the add-people picker", async ({ browser }, info) => {
    const { context, page, errors } = await signedInPage(browser, ACME.member);
    try {
      expect((await page.goto("/dashboard/lists"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Lists" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("lists-member", info.project.name), fullPage: true });

      const name = `UI list ${runId(info.project.name)}`;
      await page.getByRole("button", { name: "Create list" }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("heading", { name: "Create list" })).toBeVisible();
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByRole("button", { name: "Create list" }).click();
      await expect(page).toHaveURL(/\/dashboard\/lists\/[0-9a-f-]+$/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      await expect(page.getByText("This list is empty")).toBeVisible();

      // Members can add but not delete lists.
      await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
      await page.getByRole("button", { name: "Add people" }).click();
      const picker = page.getByRole("dialog");
      await expect(picker.getByRole("heading", { name: "Add people" })).toBeVisible();
      await expect(picker.getByRole("list", { name: "Search results" }).getByRole("listitem").first()).toBeVisible();
      await picker.getByRole("listitem").first().getByRole("checkbox").click();
      await picker.getByRole("button", { name: /Add 1 record/ }).click();
      await expect(page.getByRole("table")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("list-detail-member", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a viewer sees lists read-only, in dark mode", async ({ browser }, info) => {
    const { context, page, errors } = await signedInPage(browser, ACME.viewer, { dark: true });
    try {
      expect((await page.goto("/dashboard/lists"))?.status()).toBe(200);
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(page.getByRole("heading", { level: 1, name: "Lists" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Create list" })).toHaveCount(0);
      await page.getByRole("link", { name: "Q4 target accounts — sales leaders" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Q4 target accounts — sales leaders" })).toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();
      for (const name of ["Add people", "Edit", "Delete"]) {
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      }
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("list-detail-viewer-dark", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
