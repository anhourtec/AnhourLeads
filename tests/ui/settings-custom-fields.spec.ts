import { expect as baseExpect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAs, uid } from "./records-ui";

test.describe.configure({ timeout: 180_000 });
const expect = baseExpect.configure({ timeout: 30_000 });

/** Dev-server hot reloads (other files changing while the suite runs) can log this; it isn't a page error. */
const real = (errors: string[]) => errors.filter((e) => !e.includes("Router action dispatched before initialization"));

test.describe("custom fields and personas settings", () => {
  test("admin adds a picklist field; viewer sees it read-only", async ({ browser }, info) => {
    const label = `Tier ${uid()}`;
    const admin = await openAs(browser, ACME.admin);
    try {
      const { page, errors } = admin;
      const res = await page.goto("/dashboard/settings/custom-fields?tab=company");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Custom fields" })).toBeVisible();
      await expect(page.getByRole("tab", { name: /Accounts/ })).toHaveAttribute("aria-selected", "true");
      await page.getByRole("button", { name: "Add field" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add field" });
      await dialog.getByLabel("Label").fill(label);
      await dialog.getByLabel("Type").selectOption("picklist");
      await dialog.getByLabel("Options").fill("Gold\nSilver");
      await dialog.getByRole("button", { name: "Add field" }).click();
      await expect(dialog).toBeHidden();
      const row = page.getByRole("row", { name: new RegExp(label) });
      await expect(row).toBeVisible();
      await expect(row).toContainText("Picklist");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `.playwright-mcp/wp-b/custom-fields-${info.project.name}.png`, fullPage: true });

      await row.getByRole("button", { name: `Edit ${label}` }).click();
      const edit = page.getByRole("dialog", { name: "Edit field" });
      await expect(edit.getByLabel("Type")).toBeDisabled();
      await edit.getByRole("button", { name: "Cancel" }).click();
      expect(real(errors)).toEqual([]);
    } finally {
      await admin.context.close();
    }

    const viewer = await openAs(browser, ACME.viewer, { dark: true });
    try {
      await viewer.page.goto("/dashboard/settings/custom-fields?tab=company");
      await expect(viewer.page.getByRole("row", { name: new RegExp(label) })).toBeVisible();
      await expect(viewer.page.getByRole("button", { name: "Add field" })).toHaveCount(0);
      await expect(viewer.page.getByRole("button", { name: `Delete ${label}` })).toHaveCount(0);
      await expectNoHorizontalOverflow(viewer.page);
      expect(real(viewer.errors)).toEqual([]);
    } finally {
      await viewer.context.close();
    }
  });

  test("manager creates a persona; member can't edit", async ({ browser }, info) => {
    const name = `Buyers ${uid()}`;
    const manager = await openAs(browser, ACME.manager);
    try {
      const { page, errors } = manager;
      const res = await page.goto("/dashboard/settings/personas");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Personas" })).toBeVisible();
      await page.getByRole("button", { name: "Create persona" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Create persona" });
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByLabel("Job titles").fill("Head of sales");
      await dialog.getByLabel("Job titles").press("Enter");
      await expect(dialog.getByRole("button", { name: "Remove Head of sales" })).toBeVisible();
      await dialog.getByRole("checkbox", { name: "Director" }).click();
      await dialog.getByRole("checkbox", { name: "Sales" }).click();
      await dialog.getByRole("button", { name: "Create persona" }).click();
      await expect(dialog).toBeHidden();
      const row = page.getByRole("row", { name: new RegExp(name) });
      await expect(row).toContainText("Head of sales");
      await expect(row).toContainText("Director");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `.playwright-mcp/wp-b/personas-${info.project.name}.png`, fullPage: true });
      expect(real(errors)).toEqual([]);
    } finally {
      await manager.context.close();
    }

    const member = await openAs(browser, ACME.member);
    try {
      await member.page.goto("/dashboard/settings/personas");
      await expect(member.page.getByRole("row", { name: new RegExp(name) })).toBeVisible();
      await expect(member.page.getByRole("button", { name: "Create persona" })).toHaveCount(0);
      await expect(member.page.getByRole("button", { name: `Edit ${name}` })).toHaveCount(0);
      expect(real(member.errors)).toEqual([]);
    } finally {
      await member.context.close();
    }
  });
});
