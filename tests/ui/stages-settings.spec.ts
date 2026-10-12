import { expect as baseExpect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, openAsUser, realErrors, wpdShot } from "./_wp-d-ui";

test.describe.configure({ timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

test.describe("contact and account stages settings", () => {
  test("owner sees stages, account stages and triggers, and saves without changes", async ({ browser }, info) => {
    const { context, page, errors } = await openAsUser(browser, ACME.owner, {
      dark: info.project.name === "ui-tablet",
    });
    try {
      const res = await page.goto("/dashboard/settings/contact-stages");
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Contact fields and stages" })).toBeVisible();
      await expect(page.getByLabel("Name for new")).toHaveValue("Cold");
      await expect(page.getByLabel("Name for contacted")).toHaveValue("Approaching");
      await expect(page.getByRole("checkbox", { name: /override Interested/ })).toBeChecked();
      await expect(page.getByText("Custom stages are coming")).toBeVisible();
      await page.getByRole("button", { name: "Save stages" }).click();
      await expect(page.getByText("Stages saved")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpdShot("contact-stages", info.project.name), fullPage: true, caret: "initial" });

      await page.getByRole("tab", { name: "Account stages" }).click();
      await expect(page.getByLabel("Name for customer")).toBeVisible();

      await page.getByRole("tab", { name: "Triggers" }).click();
      await expect(page.getByLabel("Stage when: Email bounced")).toHaveValue("bad_data");
      await expect(page.getByLabel("Stage when: Blocked as spam")).toHaveValue("");
      await expect(page.getByLabel("Stage when: Unsubscribed")).toHaveValue("do_not_contact");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: wpdShot("stage-triggers", info.project.name), fullPage: true, caret: "initial" });
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a member sees the stages read-only", async ({ browser }) => {
    const { context, page, errors } = await openAsUser(browser, ACME.member);
    try {
      await page.goto("/dashboard/settings/contact-stages");
      await expect(page.getByText("Only administrators and owners can change stages")).toBeVisible();
      await expect(page.getByLabel("Name for new")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Save stages" })).toHaveCount(0);
      await page.getByRole("tab", { name: "Triggers" }).click();
      await expect(page.getByLabel("Stage when: Replied")).toBeDisabled();
      await expectNoHorizontalOverflow(page);
      expect(realErrors(errors)).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
