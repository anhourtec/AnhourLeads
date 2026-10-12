import { expect as baseExpect, type Page, test } from "@playwright/test";

import { createContact, mailpitMailbox, uniq } from "../api/_engage";
import { addFreshMember, db } from "../api/admin-helpers";
import { ACME, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER, newUiContext } from "../support/session";
import { expectNoHorizontalOverflow, runId, signedInPage, watchErrors } from "./_engage-ui";

// The shared dev server recompiles while other work is edited; allow for slow responses.
test.describe.configure({ timeout: 180_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

const shot = (name: string, project: string) => `.playwright-mcp/wp-c/a-${project}-${name}.png`;

async function ownerSequence(name: string, extra: Record<string, unknown> = {}) {
  const owner = await apiAs(ACME.owner);
  const res = await owner.post("/api/v1/emailer_campaigns", {
    data: {
      name,
      steps: [{ type: "auto_email", subject: "Hi {{first_name}}", body: "Hello {{first_name}}" }],
      ...extra,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).emailer_campaign.id as string;
}

async function openTab(page: Page, name: string) {
  await page.getByRole("tab", { name: new RegExp(`^${name}`) }).click();
}

test.describe("sequences list", () => {
  test("tabs, banners, filters and the table", async ({ browser }, info) => {
    const name = `List ${runId(info.project.name)}`;
    await ownerSequence(name, { tags: ["parity"] });
    const { context, page, errors } = await signedInPage(browser, ACME.member);
    try {
      expect((await page.goto("/dashboard/sequences"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Sequences" })).toBeVisible();
      for (const tab of ["All sequences", "Analytics", "Diagnostics"]) {
        await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`) })).toBeVisible();
      }
      // The bounce guard note can be dismissed and stays dismissed.
      const banner = page.getByText("Bounce guard is on");
      await page.evaluate(() => window.localStorage.removeItem("anhour:sequences:bounce-guard-banner"));
      await page.reload();
      await expect(banner).toBeVisible();
      await expect(page.getByRole("link", { name: "sending protection settings" })).toHaveAttribute(
        "href",
        "/dashboard/settings/deliverability/sending-protection",
      );
      await page.getByRole("button", { name: "Dismiss" }).click();
      await expect(banner).toHaveCount(0);
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Sequences" })).toBeVisible();
      await expect(banner).toHaveCount(0);

      // Search and tag filters live in the URL.
      await page.getByRole("searchbox", { name: "Search sequences" }).fill(name);
      await expect(page).toHaveURL(/q=/);
      const row = page.getByRole("row").filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await expect(row.getByText("parity")).toBeVisible();
      await expect(row.getByRole("switch", { name: `Active: ${name}` })).toBeVisible();
      await row.getByRole("button", { name: `Star ${name}` }).click();
      await expect(row.getByRole("button", { name: `Unstar ${name}` })).toBeVisible();
      await page.getByLabel("Tag").selectOption("parity");
      await expect(page).toHaveURL(/tag=parity/);
      await expect(page.getByRole("row").filter({ hasText: name })).toHaveCount(1);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("01-sequences", info.project.name), fullPage: true });

      await openTab(page, "Analytics");
      await expect(page).toHaveURL(/tab=analytics/);
      await expect(page.getByText("Emails sent")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await openTab(page, "Diagnostics");
      await expect(page).toHaveURL(/tab=diagnostics/);
      await expect(
        page.getByRole("list", { name: "Sequences with issues" }).or(page.getByText("No problems found")),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("02-diagnostics", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a workspace without a ready mailbox sees the link-mailbox warning", async ({ browser }) => {
    const globex = await apiAs(GLOBEX_OWNER);
    const mailboxes = (await (await globex.get("/api/v1/email_accounts")).json()).email_accounts as {
      readyToSend: boolean;
    }[];
    test.skip(
      mailboxes.some((m) => m.readyToSend),
      "Globex already has a ready mailbox",
    );
    const { context, page, errors } = await signedInPage(browser, GLOBEX_OWNER);
    try {
      await page.goto("/dashboard/sequences");
      await expect(page.getByText("No mailbox is ready to send.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Link mailbox" })).toHaveAttribute(
        "href",
        "/dashboard/mailboxes?new=1",
      );
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("dark mode list for a viewer is read-only", async ({ browser }, info) => {
    const name = `Viewer ${runId(info.project.name)}`;
    const id = await ownerSequence(name);
    const { context, page, errors } = await signedInPage(browser, ACME.viewer, { dark: true });
    try {
      await page.goto(`/dashboard/sequences?q=${encodeURIComponent(name)}`);
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(page.getByRole("button", { name: "Create sequence" })).toHaveCount(0);
      const row = page.getByRole("row").filter({ hasText: name });
      await expect(row.getByRole("switch")).toBeDisabled();
      await expect(row.getByRole("button", { name: `Star ${name}` })).toBeDisabled();
      await page.screenshot({ path: shot("03-list-dark-viewer", info.project.name), fullPage: true });

      await page.goto(`/dashboard/sequences/${id}?tab=settings`);
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      for (const label of ["Add contacts", "Update settings", "More actions"]) {
        await expect(page.getByRole("button", { name: label })).toHaveCount(0);
      }
      await expect(page.getByLabel("Name", { exact: true })).toBeDisabled();
      await expect(page.getByRole("button", { name: "Optimize" })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("creating sequences", () => {
  test("a fresh member must accept the anti-spam acknowledgement first", async ({ browser }, info) => {
    const fresh = await addFreshMember(await apiAsRole("owner"), "member", "antispam");
    const { rows } = await db().query("select id from onboarding_state where user_id = $1", [fresh.userId]);
    if (rows.length) {
      await db().query(
        "update onboarding_state set finished_at = now(), completed_steps = '{email_skipped}', anti_spam_accepted_at = null where user_id = $1",
        [fresh.userId],
      );
    } else {
      await db().query(
        "insert into onboarding_state (id, organization_id, user_id, finished_at, completed_steps) values ($1, (select id from organization where slug = 'acme'), $2, now(), '{email_skipped}')",
        [crypto.randomUUID(), fresh.userId],
      );
    }
    const context = await newUiContext(browser, { baseURL: BASE_URL, storageState: await fresh.api.storageState() });
    const page = await context.newPage();
    const errors = watchErrors(page);
    try {
      await page.goto("/dashboard/sequences");
      await page.getByRole("button", { name: "Create sequence" }).first().click();
      const consent = page.getByRole("dialog", { name: "Send responsibly" });
      await expect(consent).toBeVisible();
      await page.screenshot({ path: shot("04-anti-spam", info.project.name) });
      await consent.getByRole("button", { name: "I decline" }).click();
      await expect(consent).toHaveCount(0);
      await expect(page.getByRole("dialog", { name: "New sequence" })).toHaveCount(0);

      await page.getByRole("button", { name: "Create sequence" }).first().click();
      await page
        .getByRole("dialog", { name: "Send responsibly" })
        .getByRole("button", { name: "I will comply" })
        .click();
      const dialog = page.getByRole("dialog", { name: "New sequence" });
      await expect(dialog).toBeVisible();
      const name = `Consent ${runId(info.project.name)}`;
      await dialog.getByLabel("Sequence name").fill(name);
      await dialog.getByRole("button", { name: "Create" }).click();
      await expect(page).toHaveURL(/\/dashboard\/sequences\/[0-9a-f-]+$/, { timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      const state = await (await fresh.api.get("/api/v1/consents/anti-spam")).json();
      expect(state.anti_spam.required).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("new sequence modal with schedule preview, and creating with AI", async ({ browser }, info) => {
    const { context, page, errors } = await signedInPage(browser, ACME.member);
    try {
      await page.goto("/dashboard/sequences");
      await page.getByRole("button", { name: "Create sequence" }).first().click();
      const dialog = page.getByRole("dialog", { name: "New sequence" });
      await expect(dialog.getByLabel("Schedule")).toBeVisible();
      await expect(dialog.getByRole("link", { name: "schedule settings" })).toHaveAttribute(
        "href",
        "/dashboard/settings/schedules",
      );
      const schedules = (await (await (await apiAs(ACME.member)).get("/api/v1/emailer_schedules")).json())
        .emailer_schedules as { id: string; isDefault: boolean }[];
      await expect(dialog.getByLabel("Schedule")).toHaveValue(schedules.find((s) => s.isDefault)?.id ?? "");
      await expect(dialog.getByLabel("Weekly sending windows")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("05-new-sequence", info.project.name) });
      await dialog.getByRole("button", { name: "Back" }).click();
      await expect(dialog).toHaveCount(0);

      // Create with AI is offered from the empty state; here, open it through a template-free path.
      await page.goto("/dashboard/sequences?q=__nothing__");
      await expect(page.getByText("No sequences match these filters.")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }

    // The empty-state hero (Create with AI / Create manually ▾) shows for a workspace with no sequences.
    const globex = await apiAs(GLOBEX_OWNER);
    const total = (await (await globex.post("/api/v1/emailer_campaigns/search", { data: {} })).json()).pagination
      .total_entries as number;
    if (total > 0) return; // The first-run hero only shows in a workspace without sequences.
    const g = await signedInPage(browser, GLOBEX_OWNER);
    try {
      await g.page.goto("/dashboard/sequences");
      await expect(g.page.getByRole("heading", { name: "Create your first sequence" })).toBeVisible();
      await g.page.getByRole("button", { name: "Create with AI" }).click();
      const ai = g.page.getByRole("dialog", { name: "Create with AI" });
      await ai.getByLabel("Who are you writing to?").fill("Heads of sales at software companies");
      await ai.getByLabel("What should they do?").fill("Book a demo");
      await ai.getByRole("button", { name: "Draft sequence" }).click();
      await expect(ai.getByRole("list", { name: "Drafted steps" }).getByRole("listitem")).toHaveCount(4);
      await ai.getByRole("button", { name: "Use this outline" }).click();
      const created = g.page.getByRole("dialog", { name: "New sequence" });
      await expect(created.getByLabel("Sequence name")).toHaveValue(/Heads of sales/);
      await created.getByRole("button", { name: "Back" }).click();
      await expect(g.page.getByRole("dialog", { name: "Create with AI" })).toBeVisible();
      expect(g.errors).toEqual([]);
    } finally {
      await g.context.close();
    }
  });

  test("create with AI from the list (member)", async ({ browser }, info) => {
    // Member path: AI drafting through the API-backed dialog reachable from the empty hero is covered
    // above; here the generate endpoint drives a full create from the new sequence modal.
    const member = await apiAs(ACME.member);
    const draft = (
      await (
        await member.post("/api/v1/emailer_campaigns/generate", {
          data: { audience: "Founders", goal: "Reply with interest", steps: 3, tone: "direct" },
        })
      ).json()
    ).draft as { name: string; steps: unknown[] };
    expect(draft.steps).toHaveLength(3);
    const res = await member.post("/api/v1/emailer_campaigns", {
      data: { name: `AI ${runId(info.project.name)}`, steps: draft.steps },
    });
    expect(res.status(), await res.text()).toBe(201);
    const id = (await res.json()).emailer_campaign.id as string;
    const { context, page, errors } = await signedInPage(browser, ACME.member);
    try {
      await page.goto(`/dashboard/sequences/${id}?tab=report`);
      await expect(page.getByRole("heading", { name: "By step" })).toBeVisible();
      await expect(page.getByRole("cell", { name: /^Step 3:/ })).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

test.describe("sequence page", () => {
  test("header actions: optimize, share, clone", async ({ browser }, info) => {
    const name = `Header ${runId(info.project.name)}`;
    const id = await ownerSequence(name);
    const { context, page, errors } = await signedInPage(browser, ACME.member);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    try {
      await page.goto(`/dashboard/sequences/${id}`);
      await expect(
        page.getByRole("navigation", { name: "breadcrumb" }).getByRole("link", { name: "Sequences" }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      for (const tab of ["Editor", "Contacts", "Activity", "Health", "Report", "Settings"]) {
        await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`) })).toBeVisible();
      }
      await page.getByRole("button", { name: "Optimize" }).click();
      const optimize = page.getByRole("dialog", { name: "Ways to improve this sequence" });
      await expect(optimize.getByText("Add a phone call step")).toBeVisible();
      await optimize.getByRole("button", { name: "Close" }).first().click();

      await openTab(page, "Health");
      await expect(page.getByText("Bounce rate")).toBeVisible();
      await openTab(page, "Activity");
      await expect(page.getByText("No activity yet")).toBeVisible();
      await expectNoHorizontalOverflow(page);

      // Members can't delete; clone creates a draft copy.
      await page.getByRole("button", { name: "More actions" }).click();
      await expect(page.getByRole("menuitem", { name: "Delete" })).toHaveCount(0);
      await page.getByRole("menuitem", { name: "Clone" }).click();
      await expect(page.getByRole("heading", { level: 1, name: `Copy of ${name}` })).toBeVisible({ timeout: 30_000 });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("contacts tab: add from search, skip report and bulk pause", async ({ browser }, info) => {
    const id = await ownerSequence(`Contacts ${runId(info.project.name)}`);
    const marker = uniq("Bulk");
    await createContact("acme", { firstName: "Ready", lastName: marker });
    await createContact("acme", { firstName: "Second", lastName: marker });
    await createContact("acme", { firstName: "Invalid", lastName: marker, emailStatus: "invalid" });
    const { context, page, errors } = await signedInPage(browser, ACME.member);
    try {
      await page.goto(`/dashboard/sequences/${id}?tab=contacts`);
      await expect(page.getByText("Nobody is in this sequence yet")).toBeVisible();
      await page.getByRole("button", { name: "Add contacts" }).click();
      await page.getByRole("menuitem", { name: "From search" }).click();
      const dialog = page.getByRole("dialog", { name: "Add contacts from search" });
      await dialog.getByRole("searchbox", { name: "Search people" }).fill(marker);
      const results = dialog.getByRole("list", { name: "Search results" }).getByRole("listitem");
      await expect(results).toHaveCount(3);
      for (let i = 0; i < 3; i++) await results.nth(i).getByRole("checkbox").click();
      await dialog.getByRole("button", { name: "Add 3 people" }).click();
      const report = page.getByRole("dialog", { name: "Contacts added" });
      await expect(report.getByText(/Enrolled 2, skipped 1/)).toBeVisible();
      await expect(report.getByRole("list", { name: "Skipped people" }).getByText("Email is invalid")).toBeVisible();
      await report.getByRole("button", { name: "Done" }).click();

      const table = page.getByRole("table");
      await expect(table.getByText(`Ready ${marker}`)).toBeVisible();
      await page.getByRole("checkbox", { name: "Select all on this page" }).click();
      await page.getByRole("toolbar", { name: "Bulk actions" }).getByRole("button", { name: "Pause" }).click();
      await expect(page.getByText("2 contacts updated.")).toBeVisible();
      await openTab(page, "Contacts");
      await page.getByRole("tab", { name: /^Paused/ }).click();
      await expect(page).toHaveURL(/status=paused/);
      await expect(page.getByRole("table").getByText(`Second ${marker}`)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: shot("06-contacts", info.project.name), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("settings: ruleset and other settings save and persist", async ({ browser }, info) => {
    const id = await ownerSequence(`Settings ${runId(info.project.name)}`);
    const owner = await apiAs(ACME.owner);
    const mailbox = await owner.post("/api/v1/email_accounts", { data: mailpitMailbox() });
    expect(mailbox.status()).toBe(201);
    const { context, page, errors } = await signedInPage(browser, ACME.manager);
    try {
      await page.goto(`/dashboard/sequences/${id}?tab=settings`);
      await page.getByLabel("When someone else at the same account replies").selectOption("pause");
      await page.getByLabel("Days after the last step").fill("9");
      await page.getByText("Email triggers").click();
      await page.getByRole("checkbox", { name: "Unresponsive" }).first().click();
      await page.getByLabel("Max emails per 24 hours").fill("40");
      await page.getByLabel("CC all emails to", { exact: true }).fill("cc@example.test");
      await page.getByRole("switch", { name: "Track clicks" }).click();
      await page.getByRole("switch", { name: "Ignore bounce protection" }).click();
      await page.getByLabel("Tags").fill("q4, outbound");
      await page.getByRole("button", { name: "Update settings" }).click();
      await expect(page.getByText("Settings updated.")).toBeVisible();
      await page.screenshot({ path: shot("07-settings", info.project.name), fullPage: true });

      await page.reload();
      await expect(page.getByLabel("When someone else at the same account replies")).toHaveValue("pause");
      await expect(page.getByLabel("Days after the last step")).toHaveValue("9");
      await expect(page.getByLabel("Max emails per 24 hours")).toHaveValue("40");
      await expect(page.getByRole("switch", { name: "Track clicks" })).toBeChecked();
      await expect(page.getByRole("switch", { name: "Ignore bounce protection" })).toBeChecked();
      const saved = (await (await owner.get(`/api/v1/emailer_campaigns/${id}`)).json()).emailer_campaign;
      expect(saved.ruleset).toMatchObject({
        sameAccountReply: "pause",
        unresponsiveAfterDays: 9,
        ignoreBounceProtection: true,
      });
      expect(saved.ruleset.notSentContactStages).toContain("unresponsive");
      expect(saved).toMatchObject({
        maxPer24h: 40,
        cc: "cc@example.test",
        trackClicks: true,
        tags: ["q4", "outbound"],
      });
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("members can't turn off bounce protection", async ({ browser }, info) => {
    const id = await ownerSequence(`Bounce ${runId(info.project.name)}`);
    const { context, page, errors } = await signedInPage(browser, ACME.member);
    try {
      await page.goto(`/dashboard/sequences/${id}?tab=settings`);
      await expect(page.getByRole("switch", { name: "Ignore bounce protection" })).toBeDisabled();
      await expect(page.getByText("Only managers and above can change this.")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
