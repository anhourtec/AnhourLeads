import { type APIRequestContext, expect as baseExpect, test } from "@playwright/test";

import { createContact, mailpitMailbox, mailpitWaitFor, uniq } from "../api/_engage";
import { ACME, apiAsRole } from "../support/session";
import { expectNoHorizontalOverflow, signedInPage } from "./_engage-ui";

test.describe.configure({ timeout: 150_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

async function mailbox(api: APIRequestContext): Promise<{ id: string; email: string }> {
  const res = await api.post("/api/v1/email_accounts", { data: mailpitMailbox({ signature: "Ola Owner\nAcme" }) });
  expect(res.status(), await res.text()).toBe(201);
  const body = (await res.json()).email_account as { id: string; email: string };
  return body;
}

test.describe("emails screen", () => {
  test("composer sends a one-off email; the list, filters, drawer and analytics show it", async ({ browser }, info) => {
    const owner = await apiAsRole("owner");
    const box = await mailbox(owner);
    const tag = uniq("em");
    const contactId = await createContact("acme", { firstName: "Mila", lastName: tag });
    const subject = `Hello {{first_name}} ${tag}`;

    const { context, page, errors } = await signedInPage(browser, ACME.owner, {
      dark: info.project.name === "ui-mobile",
    });
    try {
      expect((await page.goto(`/dashboard/emails/new?to=${contactId}`))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "New email" })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "To" })).toContainText(`Mila ${tag}`);
      await page.getByLabel("From").selectOption(box.id);
      await page.getByLabel("Subject").fill(subject);
      await page.getByLabel("Body").fill("Hi {{first_name}},\n\nA quick note.");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `.playwright-mcp/wp-c/c-03-composer-${info.project.name}.png`, fullPage: true });
      await page.getByRole("button", { name: "Send now" }).click();
      await expect(page).toHaveURL(/\/dashboard\/emails$/);

      const [mail] = await mailpitWaitFor(`subject:"${tag}"`);
      expect(mail.Subject).toBe(`Hello Mila ${tag}`);

      await page.getByLabel("Search emails").fill(tag);
      await page.getByLabel("Search emails").press("Enter");
      await expect(page).toHaveURL(/q=/);
      await expect(page.getByRole("tab", { name: /Delivered/ }).getByTestId("email-count-delivered")).toHaveText("1");
      await page.getByLabel("Mailbox").selectOption(box.id);
      await expect(page).toHaveURL(/mailbox=/);
      await expect(async () => {
        await page.getByRole("tab", { name: /Delivered/ }).click();
        await expect(page).toHaveURL(/status=delivered/, { timeout: 3000 });
      }).toPass({ timeout: 30_000 });
      const row = page.getByRole("button", { name: `Mila ${tag}` });
      await expect(row).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `.playwright-mcp/wp-c/c-01-emails-${info.project.name}.png`, fullPage: true });

      await row.click();
      const sheet = page.getByRole("dialog");
      await expect(sheet.getByRole("heading", { name: `Hello Mila ${tag}` })).toBeVisible();
      await expect(sheet.getByText("List-Unsubscribe", { exact: true })).toBeVisible();
      await expect(sheet.getByText("One-off email")).toBeVisible();
      await expect(sheet.getByText(/Ola Owner/)).toBeVisible();
      await expect(sheet.getByText(/Email sent/).first()).toBeVisible();
      await page.screenshot({ path: `.playwright-mcp/wp-c/c-02-email-drawer-${info.project.name}.png` });
      await page.keyboard.press("Escape");

      await page.getByRole("tab", { name: "Analytics" }).click();
      await expect(page).toHaveURL(/tab=analytics/);
      await expect(page.getByText("Emails per day")).toBeVisible();
      await expect(page.getByText("By mailbox")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      await page.getByRole("tab", { name: "Templates" }).click();
      await expect(page).toHaveURL(/tab=templates/);
      await expect(page.getByRole("button", { name: "New template" }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await owner.delete(`/api/v1/email_accounts/${box.id}`);
    }
  });

  test("a viewer reads emails but can't compose", async ({ browser }) => {
    const { context, page, errors } = await signedInPage(browser, ACME.viewer);
    try {
      expect((await page.goto("/dashboard/emails"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Emails" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Manage mailboxes" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Deliverability stats" })).toBeVisible();
      await expect(page.getByRole("link", { name: "New email" })).toHaveCount(0);
      await expect(page.getByRole("tab", { name: /Scheduled/ })).toBeVisible();
      await expect(page.getByRole("tab", { name: /Not sent/ })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
