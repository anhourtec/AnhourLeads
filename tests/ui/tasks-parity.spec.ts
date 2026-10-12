import { type APIRequestContext, expect as baseExpect, test } from "@playwright/test";

import { createContact, pg, uniq } from "../api/_engage";
import { addFreshMember } from "../api/admin-helpers";
import { ACME, apiAs, apiAsRole } from "../support/session";
import { expectNoHorizontalOverflow, signedInPage } from "./_engage-ui";

test.describe.configure({ timeout: 150_000 });
const expect = baseExpect.configure({ timeout: 20_000 });

/** A member of Acme with their own task list, past onboarding, so counts aren't shared with other runs. */
async function freshMember(prefix: string) {
  const admin = await apiAsRole("admin");
  const member = await addFreshMember(admin, "member", prefix);
  await pg().query(
    `insert into onboarding_state (id, organization_id, user_id, finished_at, completed_steps, anti_spam_accepted_at)
     values (gen_random_uuid()::text, (select id from organization where slug = 'acme'), $1, now(), '{email_skipped}', now())
     on conflict (organization_id, user_id) do update set finished_at = now(), anti_spam_accepted_at = now()`,
    [member.userId],
  );
  return { ...member, api: await apiAs(member.email) };
}

async function createTask(api: APIRequestContext, data: Record<string, unknown>) {
  const res = await api.post("/api/v1/tasks", { data });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).task as { id: string };
}

test.describe("tasks parity", () => {
  test("tab counts, create task modal with snippet and 30-minute due time", async ({ browser }, info) => {
    const member = await freshMember("tasks");
    const tag = uniq("tp");
    const contactId = await createContact("acme", { firstName: `Tara${tag}`, lastName: "Quinn" });
    const snippetBody = `Snippet body ${tag}`;
    const snippet = await member.api.post("/api/v1/snippets", { data: { name: `Snip ${tag}`, body: snippetBody } });
    expect(snippet.status()).toBe(201);

    const { context, page, errors } = await signedInPage(browser, member.email, {
      dark: info.project.name === "ui-tablet",
    });
    try {
      expect((await page.goto("/dashboard/tasks"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
      await expect(page.getByTestId("count-all")).toHaveText("0");
      await expect(page.getByText("You have no assigned tasks")).toBeVisible();
      await expect(page.getByRole("link", { name: "View all team tasks" })).toBeVisible();

      await createTask(member.api, { title: `Connect ${tag}`, type: "linkedin_connect", contactId });
      await createTask(member.api, {
        title: `Overdue call ${tag}`,
        type: "call",
        contactId,
        dueAt: new Date(Date.now() - 86_400_000).toISOString(),
      });
      await page.reload();
      await expect(page.getByTestId("count-all")).toHaveText("2");
      await expect(page.getByTestId("count-linkedin")).toHaveText("1");
      await expect(page.getByTestId("count-call")).toHaveText("1");
      await expect(page.getByTestId("count-overdue")).toHaveText("1");
      await page.getByRole("tab", { name: /LinkedIn tasks/ }).click();
      await expect(page).toHaveURL(/tab=linkedin/);
      await expect(page.getByText(`Connect ${tag}`).filter({ visible: true })).toBeVisible();
      await expect(page.getByText(`Overdue call ${tag}`).filter({ visible: true })).toHaveCount(0);

      await page.getByRole("button", { name: "Create task" }).click();
      const dialog = page.getByRole("dialog", { name: "New task" });
      await dialog.getByRole("button", { name: "Create task" }).click();
      await expect(dialog.getByText("Choose a contact or company.")).toBeVisible();
      await dialog.getByRole("combobox", { name: /Associated with/ }).click();
      await page.getByPlaceholder("Search contacts and companies").fill(`Tara${tag}`);
      await page.getByRole("option", { name: new RegExp(`Tara${tag}`) }).click();
      await dialog.getByLabel("Type").selectOption("linkedin_message");
      await dialog.getByLabel("Title").fill(`Message ${tag}`);
      await dialog.getByLabel("Description").fill("Intro: ");
      await dialog.getByRole("button", { name: "Add snippet" }).click();
      await page.getByRole("option", { name: new RegExp(`Snip ${tag}`) }).click();
      await expect(dialog.getByLabel("Description")).toHaveValue(new RegExp(snippetBody));
      await dialog.getByLabel("Due date").fill("2031-03-05");
      await dialog.getByLabel("Due time").selectOption("14:30");
      await dialog.getByLabel("Priority").selectOption("high");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `.playwright-mcp/wp-c/c-05-new-task-${info.project.name}.png` });
      await dialog.getByRole("button", { name: "Create task" }).click();
      await expect(dialog).toBeHidden();

      const { rows } = await pg().query<{ type: string; note: string; due_at: Date; contact_id: string }>(
        "select type, note, due_at, contact_id from task where title = $1",
        [`Message ${tag}`],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ type: "linkedin_message", contact_id: contactId });
      expect(rows[0].note).toContain(snippetBody);
      // The browser's local 14:30 on that day, whatever its time zone.
      const expectedDue = await page.evaluate(() => new Date("2031-03-05T14:30:00").toISOString());
      expect(new Date(rows[0].due_at).toISOString()).toBe(expectedDue);
      await expect(page.getByTestId("count-linkedin")).toHaveText("2");

      await page.getByRole("tab", { name: /All tasks/ }).click();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `.playwright-mcp/wp-c/c-04-tasks-${info.project.name}.png`, fullPage: true });

      // Bulk complete from the selection bar (desktop table / mobile cards share the checkboxes).
      await page
        .getByRole("checkbox", { name: `Select Connect ${tag}` })
        .filter({ visible: true })
        .click();
      await page.getByRole("toolbar", { name: "Bulk actions" }).getByRole("button", { name: "Complete" }).click();
      await expect(page.getByText(`Connect ${tag}`).filter({ visible: true })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("call session completes and skips call tasks and logs the call", async ({ browser }, info) => {
    const member = await freshMember("calls");
    const tag = uniq("cs");
    const first = await createContact("acme", { firstName: `Cal${tag}`, lastName: "One" });
    const second = await createContact("acme", { firstName: `Cal${tag}`, lastName: "Two" });
    await pg().query("update contact set phone = '+44 20 7946 0000' where id = $1", [first]);
    await createTask(member.api, {
      title: `Call one ${tag}`,
      type: "call",
      contactId: first,
      dueAt: new Date(Date.now() - 60_000).toISOString(),
    });
    await createTask(member.api, {
      title: `Call two ${tag}`,
      type: "call",
      contactId: second,
      dueAt: new Date().toISOString(),
    });

    const { context, page, errors } = await signedInPage(browser, member.email);
    try {
      await page.goto("/dashboard/tasks?tab=call");
      await page.getByRole("button", { name: "Start call session" }).click();
      const dialog = page.getByRole("dialog", { name: "Call session" });
      await expect(dialog.getByTestId("call-progress")).toHaveText("1 of 2");
      await expect(dialog.getByText(`Call one ${tag}`)).toBeVisible();
      await expect(dialog.getByRole("link", { name: "+44 20 7946 0000" })).toHaveAttribute("href", /^tel:/);
      await dialog.getByLabel("Outcome").selectOption("voicemail");
      await dialog.getByLabel("Notes").fill("Left a short message");
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: `.playwright-mcp/wp-c/c-06-call-session-${info.project.name}.png` });
      await dialog.getByRole("button", { name: "Complete & next" }).click();
      await expect(dialog.getByTestId("call-progress")).toHaveText("2 of 2");
      await dialog.getByRole("button", { name: "Skip" }).click();
      await expect(dialog.getByText("Session complete")).toBeVisible();
      await expect(dialog.getByText("1 call logged, 1 skipped.")).toBeVisible();

      const { rows } = await pg().query<{ type: string; metadata: { outcome: string } }>(
        "select type, metadata from activity where contact_id = $1 and type = 'call_logged'",
        [first],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].metadata.outcome).toBe("voicemail");
      const tasks = await pg().query<{ title: string; status: string }>(
        "select title, status from task where contact_id = any($1) order by title",
        [[first, second]],
      );
      expect(tasks.rows.map((t) => t.status)).toEqual(["completed", "skipped"]);
      await dialog.getByRole("button", { name: "Close" }).first().click();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  test("a viewer sees team tasks read-only", async ({ browser }) => {
    const { context, page, errors } = await signedInPage(browser, ACME.viewer, { dark: true });
    try {
      expect((await page.goto("/dashboard/tasks?scope=team&status=any"))?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
      await expect(page.getByLabel("Task scope")).toHaveValue("team");
      await expect(page.getByRole("button", { name: "Create task" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Start call session" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Complete / })).toHaveCount(0);
      await page.getByRole("button", { name: "Show filters" }).click();
      await expect(page.getByLabel("Assignee")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
