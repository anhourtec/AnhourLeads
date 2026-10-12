import { type APIRequestContext, expect as baseExpect, type Page, test } from "@playwright/test";

import { createCompany, createContact, mailpitMailbox, mailpitWaitFor, uniq } from "../api/_engage";
import { ACME, apiAs } from "../support/session";
import { expectNoHorizontalOverflow, signedInPage } from "./_engage-ui";

// The shared dev server recompiles while other work is edited; allow for slow responses.
test.describe.configure({ timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shotPath = (name: string, project: string) => `.playwright-mcp/wp-c/b-${project}-${name}.png`;

async function sequenceWithMailbox(api: APIRequestContext, steps: Record<string, unknown>[] = []) {
  const mailbox = await api.post("/api/v1/email_accounts", { data: mailpitMailbox() });
  expect(mailbox.status(), await mailbox.text()).toBe(201);
  const res = await api.post("/api/v1/emailer_campaigns", {
    data: { name: uniq("Editor seq"), mailboxId: (await mailbox.json()).email_account.id, steps },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).emailer_campaign.id as string;
}

async function openEditor(page: Page, id: string) {
  const res = await page.goto(`/dashboard/sequences/${id}`);
  expect(res?.status()).toBe(200);
  await expect(page.getByTestId("sequence-editor")).toBeVisible({ timeout: 60_000 });
}

async function pick(page: Page, trigger: string, type: string) {
  await page.getByRole("button", { name: trigger, exact: true }).last().click();
  await page.getByRole("menuitem", { name: new RegExp(`^${type}`) }).click();
}

test.describe("sequence editor", () => {
  test("an owner builds, tests, previews and saves steps", async ({ browser }, info) => {
    const project = info.project.name;
    const api = await apiAs(ACME.owner);
    const marker = uniq("edit");
    const snippetName = uniq("Snippet");
    const snippet = await api.post("/api/v1/snippets", { data: { name: snippetName, body: `SNIP-${marker}` } });
    expect(snippet.status(), await snippet.text()).toBe(201);
    const id = await sequenceWithMailbox(api);
    const companyId = await createCompany("acme", { name: `Preview Co ${marker}` });
    const contactId = await createContact("acme", { firstName: "Robin", companyId });
    const enroll = await api.post(`/api/v1/emailer_campaigns/${id}/add_contact_ids`, {
      data: { contactIds: [contactId] },
    });
    expect(enroll.status()).toBe(200);

    const { context, page, errors } = await signedInPage(browser, ACME.owner);
    try {
      await openEditor(page, id);
      await expect(page.getByText("Your sequence is empty")).toBeVisible();
      await expect(page.getByRole("button", { name: "Select a template" })).toBeVisible();
      await expect(page.getByRole("button", { name: "AI-assisted sequence" })).toBeVisible();

      // Step picker with every type.
      await page.getByRole("button", { name: "Add a step", exact: true }).click();
      await expect(page.getByRole("menuitem")).toHaveCount(8);
      await page.screenshot({ path: shotPath("02-step-picker", project) });
      await page.getByRole("menuitem", { name: /^Automatic email/ }).click();

      const step1 = page.getByTestId("step-card-1").filter({ visible: true });
      await expect(step1.getByText("Step 1: Automatic email")).toBeVisible();
      await step1.getByLabel("Subject").fill(`Hello {{first_name}} ${marker}`);
      const body1 = step1.getByLabel("Body");
      await body1.fill("Hi {{first_name}}, ");
      await body1.press("End");
      await step1.getByRole("button", { name: "Insert snippet" }).click();
      await page.getByRole("option", { name: new RegExp(snippetName) }).click();
      await expect(body1).toHaveValue(new RegExp(`SNIP-${marker}`));

      await pick(page, "Add a step", "Phone call");
      await pick(page, "Add a step", "LinkedIn: send connection request");
      await expect(page.getByTestId("step-card-3").filter({ visible: true })).toBeVisible();

      // Wait editor on the connector pill.
      await page.getByRole("button", { name: /Edit wait before step 2/ }).click();
      await page.getByRole("spinbutton", { name: "Days" }).fill("2");
      await page.getByRole("spinbutton", { name: "Minutes" }).fill("15");
      await page.getByRole("button", { name: "Apply" }).click();
      await expect(page.getByTestId("wait-pill-2")).toContainText("Wait 2 days 15 minutes");

      // Step off switch.
      await page.getByRole("switch", { name: "Step 3 on" }).click();
      await expect(page.getByTestId("step-card-3").filter({ visible: true })).toContainText("Off");

      // A/B test: add B, deactivate it.
      await step1.getByRole("button", { name: "Add test" }).click();
      await expect(step1.getByRole("tab", { name: /Test B/ })).toHaveAttribute("aria-selected", "true");
      await step1.getByRole("button", { name: "Deactivate B" }).click();
      await expect(step1.getByRole("tab", { name: /Test B/ })).toContainText("Inactive");

      // Assisted mode fills the template for the selected version (B).
      await step1.getByRole("radio", { name: "Assisted" }).click();
      await expect(step1.getByText("Choose the email type")).toBeVisible();
      await page.screenshot({ path: shotPath("03-assisted", project), fullPage: true });
      await step1.getByRole("button", { name: "Follow-up" }).click();
      await step1.getByRole("button", { name: "Generate draft" }).click();
      await expect(step1.getByText("Drafted from a template.")).toBeVisible();
      await expect(step1.getByLabel("Body")).toHaveValue(/Following up/);

      // Prompt mode without a provider explains and still drafts.
      await step1.getByRole("radio", { name: "Prompt" }).click();
      await step1.getByLabel("Instruction").fill("A short note about saving time");
      await step1.getByRole("button", { name: "Write draft" }).click();
      await expect(step1.getByText(/No AI provider is configured/)).toBeVisible();
      await step1.getByRole("radio", { name: "Template" }).click();

      // Preview version A for the enrolled contact.
      await step1.getByRole("tab", { name: /Test A/ }).click();
      const preview = step1.getByRole("region", { name: /Preview for a contact/ });
      await expect(preview.getByLabel("Contact")).toHaveValue(contactId);
      await preview.getByRole("button", { name: "Refresh" }).click();
      await expect(preview.getByTestId("email-preview")).toContainText(`Hello Robin ${marker}`);
      await preview.getByRole("radio", { name: "Mobile width" }).click();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shotPath("01-editor", project), fullPage: true });

      // Send me a test email.
      await step1.getByRole("button", { name: "Send me a test email" }).click();
      await expect(page.getByText(`Test email sent to ${ACME.owner}.`)).toBeVisible();
      await mailpitWaitFor(`subject:"${marker}" subject:"[Test]"`);

      // Leaving with unsaved changes asks first.
      const away = page.locator('a[href="/dashboard/sequences"]').first();
      if (await away.count()) {
        await away.click();
        await expect(page.getByRole("alertdialog", { name: "Discard unsaved changes?" })).toBeVisible();
        await page.getByRole("button", { name: "Keep editing" }).click();
        await expect(page).toHaveURL(new RegExp(`/dashboard/sequences/${id}`));
      }

      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Changes saved.")).toBeVisible();

      const saved = await (await api.get(`/api/v1/emailer_campaigns/${id}/steps`)).json();
      const steps = saved.emailer_steps as {
        type: string;
        waitDays: number;
        waitMinutes: number;
        enabled: boolean;
        body: string | null;
        variants: { label: string; active: boolean }[];
      }[];
      expect(steps.map((s) => s.type)).toEqual(["auto_email", "call", "linkedin_connect"]);
      expect(steps[0].variants.map((v) => [v.label, v.active])).toEqual([
        ["A", true],
        ["B", false],
      ]);
      expect(steps[0].body).toContain(`SNIP-${marker}`);
      expect([steps[1].waitDays, steps[1].waitMinutes]).toEqual([2, 15]);
      expect(steps[2].enabled).toBe(false);

      await page.reload();
      await expect(page.getByTestId("step-card-3").filter({ visible: true })).toContainText("Off");
      await expect(page.getByTestId("step-card-1").filter({ visible: true })).toContainText("Test A");

      // Collapse and the outline drawer.
      await page.getByRole("button", { name: "Collapse steps" }).click();
      await expect(page.getByTestId("step-card-1").filter({ visible: true }).getByLabel("Body")).toHaveCount(0);
      await page.getByRole("button", { name: /3 steps/ }).click();
      await expect(page.getByRole("dialog", { name: "Steps" })).toBeVisible();
      await page
        .getByRole("dialog", { name: "Steps" })
        .getByRole("button", { name: /Step 2: Phone call/ })
        .click();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("templates load into an empty sequence; dark mode", async ({ browser }, info) => {
    const api = await apiAs(ACME.member);
    const id = await sequenceWithMailbox(await apiAs(ACME.owner));
    const { context, page, errors } = await signedInPage(browser, ACME.member, { dark: true });
    try {
      await openEditor(page, id);
      await page.getByRole("button", { name: "Select a template" }).click();
      await page.getByRole("dialog").getByText("Cold outreach").click();
      await page.getByRole("button", { name: "Use template" }).click();
      await expect(page.getByTestId("step-card-4").filter({ visible: true })).toBeVisible();
      await expect(page.getByText("You have unsaved changes.")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shotPath("04-dark", info.project.name), fullPage: true });
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page.getByText("Changes saved.")).toBeVisible();
      const saved = await (await api.get(`/api/v1/emailer_campaigns/${id}/steps`)).json();
      expect(saved.emailer_steps).toHaveLength(4);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("viewers see the steps read-only", async ({ browser }) => {
    const owner = await apiAs(ACME.owner);
    const id = await sequenceWithMailbox(owner, [
      { type: "auto_email", subject: "Read only {{first_name}}", body: "Body" },
      { type: "call", waitDays: 1, body: "Call them" },
    ]);
    const { context, page, errors } = await signedInPage(browser, ACME.viewer);
    try {
      await openEditor(page, id);
      await expect(page.getByTestId("step-card-2").filter({ visible: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Add a step" })).toHaveCount(0);
      await expect(page.getByRole("switch", { name: "Step 1 on" })).toBeDisabled();
      await expect(page.getByTestId("step-card-1").filter({ visible: true }).getByLabel("Body")).toBeDisabled();
      await expect(page.getByRole("button", { name: "Send me a test email" })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
