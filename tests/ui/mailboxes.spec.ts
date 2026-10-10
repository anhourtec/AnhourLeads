import { expect as baseExpect, test } from "@playwright/test";

import { ACME } from "../support/session";
import { expectNoHorizontalOverflow, runId, shot, signedInPage } from "./_engage-ui";

// The shared dev server recompiles while other work is edited; allow for slow responses.
test.describe.configure({ timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

test.describe("mailboxes screen", () => {
  test("a manager adds a mailbox with a write-only password and tests the connection", async ({ browser }, info) => {
    const { context, page, errors } = await signedInPage(browser, ACME.manager);
    const email = `ui-${runId(info.project.name)}@acme.test`;
    const password = "ui-secret-pass-wxyz";
    try {
      expect((await page.goto("/dashboard/mailboxes"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Mailboxes" })).toBeVisible();
      await page.getByRole("button", { name: "Add mailbox" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Email address").fill(email);
      await dialog.getByLabel("Sender name").fill("UI Sender");
      await dialog.getByLabel("Host").fill("127.0.0.1");
      await dialog.getByLabel("Port").fill("48025");
      await dialog.getByLabel("Security").selectOption("none");
      await dialog.getByLabel("Username").fill("ui-user");
      await dialog.getByLabel("Password", { exact: true }).fill(password);
      await dialog.getByLabel("Postal address").fill("1 Test Street, Springfield");
      await dialog.getByRole("button", { name: "Add mailbox" }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });

      const card = page.locator("[data-slot=card]").filter({ hasText: email });
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card.getByText("wxyz")).toBeVisible();
      expect(await page.content()).not.toContain(password);

      await card.getByRole("button", { name: "Edit" }).click();
      const edit = page.getByRole("dialog");
      await expect(edit.getByLabel("Password", { exact: true })).toHaveValue("");
      await expect(edit.getByLabel("Password", { exact: true })).toHaveAttribute("placeholder", /ends in wxyz/);
      await expectNoHorizontalOverflow(page);
      await page.keyboard.press("Escape");

      await card.getByRole("button", { name: "Test connection" }).click();
      await expect(page.getByText(/Connected to 127\.0\.0\.1/)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("mailboxes-manager", info.project.name), fullPage: true });

      await card.getByRole("button", { name: "Remove" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Remove" }).click();
      await expect(card).toHaveCount(0, { timeout: 15_000 });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  for (const role of ["member", "viewer"] as const) {
    test(`a ${role} sees mailboxes without edit controls`, async ({ browser }, info) => {
      const { context, page, errors } = await signedInPage(browser, ACME[role], { dark: role === "viewer" });
      try {
        expect((await page.goto("/dashboard/mailboxes"))?.status()).toBe(200);
        await expect(page.getByRole("heading", { level: 1, name: "Mailboxes" })).toBeVisible();
        await expect(page.getByText("member@acme.test").first()).toBeVisible();
        // The seeded mailbox has no SMTP settings or postal address: the hints say so.
        await expect(page.getByText(/Add a postal address/).first()).toBeVisible();
        for (const name of ["Add mailbox", "Edit", "Test connection", "Remove"]) {
          await expect(page.getByRole("button", { name })).toHaveCount(0);
        }
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: shot(`mailboxes-${role}`, info.project.name), fullPage: true });
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
});
