import { expect as baseExpect, test } from "@playwright/test";

import { can, ROLES } from "../../src/lib/rbac/permissions";
import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAs, shot, uid } from "./admin-ui";

test.describe.configure({ timeout: 90_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

test.describe("deals screen", () => {
  for (const role of ROLES) {
    test(`board renders for ${role}`, async ({ browser }) => {
      const { context, page, errors } = await openAs(browser, ACME[role]);
      try {
        const res = await page.goto("/dashboard/deals");
        expect(res?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Deals" })).toBeVisible();
        for (const stage of ["qualify", "meeting", "proposal", "negotiation", "won", "lost"]) {
          await expect(page.getByTestId(`stage-${stage}`)).toHaveCount(1);
        }
        if (can(role, "deal:create"))
          await expect(page.getByRole("button", { name: "New deal" }).first()).toBeVisible();
        else await expect(page.getByRole("button", { name: "New deal" })).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test("a member creates a deal, sees it on the board and in the table", async ({ browser }, info) => {
    const name = `UI deal ${uid()}`;
    const { context, page, errors } = await openAs(browser, ACME.member, { dark: info.project.name === "ui-tablet" });
    try {
      await page.goto("/dashboard/deals");
      await page.getByRole("button", { name: "New deal" }).first().click();
      const dialog = page.getByRole("dialog", { name: "New deal" });
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByLabel("Stage").selectOption("proposal");
      await dialog.getByLabel("Amount").fill("15000");
      await dialog.getByRole("button", { name: "Create deal" }).click();
      await expect(dialog).toBeHidden();

      await page.getByLabel("Search deals").fill(name);
      await page.getByLabel("Search deals").press("Enter");
      await expect(page.getByTestId("stage-proposal").getByText(name)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("deals-board", info.project.name), fullPage: true });

      await page.getByRole("radio", { name: "Table" }).click();
      await expect(page).toHaveURL(/view=table/);
      const row = page.getByRole("row").filter({ hasText: name });
      await expect(row).toBeVisible();
      await expect(row).toContainText("$15,000");
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
