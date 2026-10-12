import { expect as baseExpect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, runId, shot, signedInPage } from "./_engage-ui";

// The shared dev server recompiles while other work is edited; allow for slow responses.
test.describe.configure({ timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

test.describe("sequences screens", () => {
  test("a member creates a sequence and works through every tab", async ({ browser }, info) => {
    const { context, page, errors } = await signedInPage(browser, ACME.member);
    try {
      expect((await page.goto("/dashboard/sequences"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Sequences" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("sequences-member", info.project.name), fullPage: true, caret: "initial" });

      const name = `UI sequence ${runId(info.project.name)}`;
      await page.getByRole("button", { name: "Create sequence" }).first().click();
      const dialog = page.getByRole("dialog", { name: "New sequence" });
      await dialog.getByLabel("Sequence name").fill(name);
      await dialog.getByLabel("Description").fill("Created from the UI test.");
      await dialog.getByRole("button", { name: "Create" }).click();
      await expect(page).toHaveURL(/\/dashboard\/sequences\/[0-9a-f-]+$/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

      // Members can launch but not delete.
      await expect(page.getByRole("switch", { name: "Activate" })).toBeVisible();
      await page.getByRole("button", { name: "More actions" }).click();
      await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
      await page.keyboard.press("Escape");

      for (const tab of ["Contacts", "Activity", "Health", "Report", "Settings"]) {
        await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
        await expect(page).toHaveURL(new RegExp(`tab=${tab.toLowerCase()}`));
        await expectNoHorizontalOverflow(page);
      }
      await expect(page.getByRole("switch", { name: "Track opens" })).not.toBeChecked();
      await expect(page.getByRole("switch", { name: "Track clicks" })).not.toBeChecked();
      await expect(page.getByRole("switch", { name: "Stop on reply" })).toBeChecked();
      await page.getByLabel("Review mode").selectOption("first_step");
      await page.getByRole("button", { name: "Update settings" }).click();
      await expect(page.getByText("Settings updated.")).toBeVisible();
      await page.screenshot({
        path: shot("sequence-settings-member", info.project.name),
        fullPage: true,
        caret: "initial",
      });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
