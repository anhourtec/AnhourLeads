import { expect as baseExpect, test } from "@playwright/test";

import { uniq } from "../api/_engage";
import { ACME, apiAsRole } from "../support/session";
import { expectNoHorizontalOverflow, signedInPage } from "./_engage-ui";

test.describe.configure({ timeout: 150_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

test.describe("sending schedules settings", () => {
  test("a manager creates, edits and deletes a schedule", async ({ browser }, info) => {
    const name = `Schedule ${uniq("sc")}`;
    const { context, page, errors } = await signedInPage(browser, ACME.manager, {
      dark: info.project.name === "ui-desktop",
    });
    try {
      expect((await page.goto("/dashboard/settings/schedules"))?.status()).toBe(200);
      await expect(page.getByText("Normal business hours").first()).toBeVisible();
      await page.getByRole("button", { name: "Create new schedule" }).click();
      const dialog = page.getByRole("dialog", { name: "New schedule" });
      await dialog.getByLabel("Name").fill(name);
      await dialog.getByLabel("Time zone").selectOption("Europe/London");
      await dialog.getByRole("switch", { name: "Send on Saturday" }).click();
      await dialog.getByLabel("Saturday window 1 starts").selectOption("10:00");
      await dialog.getByLabel("Saturday window 1 ends").selectOption("12:30");
      await dialog.getByRole("switch", { name: "Send on Monday" }).click();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `.playwright-mcp/wp-c/c-07-schedule-dialog-${info.project.name}.png` });
      await dialog.getByRole("button", { name: "Create schedule" }).click();
      await expect(dialog).toBeHidden();

      const card = page.getByTestId("schedule-card").filter({ hasText: name });
      await expect(card).toBeVisible();
      await expect(card.getByText("Europe/London")).toBeVisible();
      await expect(card.getByText("10 AM–12:30 PM")).toBeVisible();
      await expect(card.getByText("Monday")).toHaveCount(0);

      await card.getByRole("button", { name: `Edit ${name}` }).click();
      const edit = page.getByRole("dialog", { name: "Edit schedule" });
      await edit.getByLabel("Name").fill(`${name} edited`);
      await edit.getByRole("button", { name: "Save schedule" }).click();
      await expect(edit).toBeHidden();
      const edited = page.getByTestId("schedule-card").filter({ hasText: `${name} edited` });
      await expect(edited).toBeVisible();

      if (info.project.name === "ui-desktop") {
        await edited.getByRole("button", { name: "Make default" }).click();
        await expect(edited.getByText("Default", { exact: true })).toBeVisible();
        await page.screenshot({ path: `.playwright-mcp/wp-c/c-08-schedules-${info.project.name}.png`, fullPage: true });
        const original = page.getByTestId("schedule-card").filter({ hasText: "Normal business hours" }).first();
        await expect(async () => {
          await original.getByRole("button", { name: "Make default" }).click({ timeout: 3000 });
          await expect(original.getByText("Default", { exact: true })).toBeVisible({ timeout: 3000 });
        }).toPass({ timeout: 30_000 });
      }

      await edited.getByRole("button", { name: `Delete ${name} edited` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete schedule" }).click();
      await expect(edited).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a member sees schedules without edit controls", async ({ browser }) => {
    const { context, page, errors } = await signedInPage(browser, ACME.member);
    try {
      expect((await page.goto("/dashboard/settings/schedules"))?.status()).toBe(200);
      await expect(page.getByText("Normal business hours").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Create new schedule" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("templates and snippets settings", () => {
  test("a member creates, edits and deletes their own; managers' templates are read-only to them", async ({
    browser,
  }, info) => {
    const tag = uniq("tpl");
    const manager = await apiAsRole("manager");
    const managerTpl = await manager.post("/api/v1/email_templates", {
      data: { name: `Manager tpl ${tag}`, subject: "Hi", body: "From the manager" },
    });
    expect(managerTpl.status()).toBe(201);

    const { context, page, errors } = await signedInPage(browser, ACME.member);
    try {
      expect((await page.goto("/dashboard/settings/templates"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Snippets & templates" })).toBeVisible();
      await page.getByRole("button", { name: "New template" }).first().click();
      const dialog = page.getByRole("dialog", { name: "New template" });
      await dialog.getByLabel("Name").fill(`Member tpl ${tag}`);
      await dialog.getByLabel("Subject").fill("Quick idea for {{company}}");
      await dialog.getByLabel("Body").fill("Hi ");
      await dialog.getByRole("button", { name: "Merge field" }).click();
      await page.getByRole("option", { name: /First name/ }).click();
      await expect(dialog.getByLabel("Body")).toHaveValue("Hi {{first_name}}");
      await dialog.getByRole("button", { name: "Create template" }).click();
      await expect(dialog).toBeHidden();

      await expect(page.getByText(`Member tpl ${tag}`)).toBeVisible();
      await expect(page.getByRole("button", { name: `Delete Manager tpl ${tag}` })).toHaveCount(0);
      await expect(page.getByRole("button", { name: `Edit Manager tpl ${tag}` })).toBeVisible();

      await page.getByRole("button", { name: `Edit Member tpl ${tag}` }).click();
      const edit = page.getByRole("dialog", { name: "Edit template" });
      await edit.getByLabel("Name").fill(`Member tpl ${tag} v2`);
      await edit.getByRole("button", { name: "Save" }).click();
      await expect(page.getByText(`Member tpl ${tag} v2`)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `.playwright-mcp/wp-c/c-09-templates-${info.project.name}.png`, fullPage: true });

      await page.getByRole("button", { name: `Delete Member tpl ${tag} v2` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete template" }).click();
      await expect(page.getByText(`Member tpl ${tag} v2`)).toHaveCount(0);

      await page.getByRole("tab", { name: /Snippets/ }).click();
      await page.getByRole("button", { name: "New snippet" }).first().click();
      const snip = page.getByRole("dialog", { name: "New snippet" });
      await snip.getByLabel("Name").fill(`Meeting link ${tag}`);
      await snip.getByLabel("Body").fill("Book a time: https://example.com/meet");
      await snip.getByRole("button", { name: "Create snippet" }).click();
      await expect(page.getByText(`Meeting link ${tag}`)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a manager can delete anyone's template; a viewer reads only", async ({ browser }) => {
    const tag = uniq("tpl");
    const member = await apiAsRole("member");
    const res = await member.post("/api/v1/email_templates", { data: { name: `Member owned ${tag}`, body: "Body" } });
    expect(res.status()).toBe(201);

    const viewer = await signedInPage(browser, ACME.viewer, { dark: true });
    try {
      await viewer.page.goto("/dashboard/settings/templates");
      await expect(viewer.page.getByText(`Member owned ${tag}`)).toBeVisible();
      await expect(viewer.page.getByRole("button", { name: "New template" })).toHaveCount(0);
      await expect(viewer.page.getByRole("button", { name: `Edit Member owned ${tag}` })).toHaveCount(0);
      await expectNoHorizontalOverflow(viewer.page);
      expect(viewer.errors).toEqual([]);
    } finally {
      await viewer.context.close();
    }

    const { context, page, errors } = await signedInPage(browser, ACME.manager);
    try {
      await page.goto("/dashboard/settings/templates");
      await page.getByRole("button", { name: `Delete Member owned ${tag}` }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Delete template" }).click();
      await expect(page.getByText(`Member owned ${tag}`)).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("mailbox link and signature", () => {
  test("?new=1 opens the add-mailbox dialog and the signature is saved", async ({ browser }, info) => {
    const email = `sig-${uniq(info.project.name)}@acme.test`;
    const { context, page, errors } = await signedInPage(browser, ACME.manager);
    try {
      expect((await page.goto("/dashboard/mailboxes?new=1"))?.status()).toBe(200);
      const dialog = page.getByRole("dialog", { name: "Add mailbox" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Email address").fill(email);
      await dialog.getByLabel("Host").fill("127.0.0.1");
      await dialog.getByLabel("Port").fill("48025");
      await dialog.getByLabel("Security").selectOption("none");
      await dialog.getByLabel("Postal address").fill("1 Test Street, Springfield");
      await dialog.getByLabel("Signature").fill("Sam Signer\nHead of growth");
      await dialog.getByRole("button", { name: "Add mailbox" }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      const card = page.locator("[data-slot=card]").filter({ hasText: email });
      await expect(card.getByText(/Sam Signer/)).toBeVisible();
      await expectNoHorizontalOverflow(page);

      const manager = await apiAsRole("manager");
      const list = (await (await manager.get("/api/v1/email_accounts")).json()).email_accounts as {
        id: string;
        email: string;
        signature: string | null;
      }[];
      const created = list.find((m) => m.email === email);
      expect(created?.signature).toBe("Sam Signer\nHead of growth");
      if (created) await manager.delete(`/api/v1/email_accounts/${created.id}`);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
