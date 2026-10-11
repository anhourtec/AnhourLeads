import { expect as baseExpect, test } from "@playwright/test";

import { can, ROLES } from "../../src/lib/rbac/permissions";
import { createContact } from "../api/_engage";
import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAs, shot, uid } from "./admin-ui";

test.describe.configure({ timeout: 90_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

test.describe("tasks screen", () => {
  for (const role of ROLES) {
    test(`renders for ${role} with role-gated actions`, async ({ browser }) => {
      const { context, page, errors } = await openAs(browser, ACME[role]);
      try {
        const res = await page.goto("/dashboard/tasks?view=all&status=any");
        expect(res?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
        await expect(page.getByRole("tab", { name: /^All tasks/ }).first()).toHaveAttribute("data-state", "active");
        const newTask = page.getByRole("button", { name: "Create task" }).first();
        if (can(role, "task:create")) await expect(newTask).toBeVisible();
        else await expect(page.getByRole("button", { name: "Create task" })).toHaveCount(0);
        if (!can(role, "task:update")) await expect(page.getByRole("button", { name: /^Complete / })).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("a member creates a task, finds it, and completes it", async ({ browser }, info) => {
    const title = `UI task ${uid()}`;
    const contactName = `Tess${uid()}`;
    await createContact("acme", { firstName: contactName });
    const { context, page, errors } = await openAs(browser, ACME.member, { dark: info.project.name === "ui-mobile" });
    try {
      await page.goto("/dashboard/tasks");
      await page.getByRole("button", { name: "Create task" }).first().click();
      const dialog = page.getByRole("dialog", { name: "New task" });
      await dialog.getByRole("combobox", { name: /Associated with/ }).click();
      await page.getByPlaceholder("Search contacts and companies").fill(contactName);
      await page
        .getByRole("option", { name: new RegExp(contactName) })
        .first()
        .click();
      await dialog.getByLabel("Title").fill(title);
      await dialog.getByLabel("Priority").selectOption("high");
      await dialog.getByLabel("Due date").fill("2030-01-15");
      await dialog.getByRole("button", { name: "Create task" }).click();
      await expect(dialog).toBeHidden();

      await page.getByLabel("Search tasks").fill(title);
      await page.getByLabel("Search tasks").press("Enter");
      await expect(page).toHaveURL(/q=UI/);
      const item = page.getByText(title).filter({ visible: true });
      await expect(item).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("tasks", info.project.name), fullPage: true });

      await page
        .getByRole("button", { name: `Complete ${title}` })
        .filter({ visible: true })
        .click();
      await expect(page.getByText(title).filter({ visible: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Show filters" }).click();
      await page.getByLabel("Status").selectOption("completed");
      await expect(page.getByText(title).filter({ visible: true })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
