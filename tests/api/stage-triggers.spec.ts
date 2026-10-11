import { type APIRequestContext, expect, request, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAsRole } from "../support/session";
import { createContact, mailpitMailbox, pg, uniq } from "./_engage";
import { EVIL_ORIGIN, freshWorkspace } from "./admin-helpers";

test.describe.configure({ timeout: 240_000 });

interface Trigger {
  event: string;
  stageKey: string | null;
}

async function readySequence(api: APIRequestContext, reviewMode: "all" | "none") {
  const mailbox = await api.post("/api/v1/email_accounts", { data: mailpitMailbox() });
  expect(mailbox.status(), await mailbox.text()).toBe(201);
  const res = await api.post("/api/v1/emailer_campaigns", {
    data: {
      name: uniq("stage-seq"),
      mailboxId: (await mailbox.json()).email_account.id,
      reviewMode,
      stopOnReply: true,
      steps: [{ type: "auto_email", waitDays: 0, subject: `Hello ${uniq("s")}`, body: "Hi {{first_name}}." }],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const id: string = (await res.json()).emailer_campaign.id;
  expect((await api.post(`/api/v1/emailer_campaigns/${id}/approve`)).status()).toBe(200);
  return id;
}

async function enrollAndRun(api: APIRequestContext, sequenceId: string, contactIds: string[]) {
  const add = await api.post(`/api/v1/emailer_campaigns/${sequenceId}/add_contact_ids`, { data: { contactIds } });
  expect(add.status(), await add.text()).toBe(200);
  const run = await api.post(`/api/v1/emailer_campaigns/${sequenceId}/run_now`);
  expect(run.status(), await run.text()).toBe(200);
}

async function stageOf(contactId: string): Promise<string> {
  const { rows } = await pg().query<{ stage: string }>("select stage from contact where id = $1", [contactId]);
  return rows[0]?.stage ?? "";
}

test.describe("stage triggers API", () => {
  test("read and write: every role per matrix; validation; CSRF", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/stage_triggers");
      expect(res.status(), role).toBe(expected(role, "contact:read"));
    }
    const owner = await apiAsRole("owner");
    const current = (await (await owner.get("/api/v1/stage_triggers")).json()).stage_triggers as Trigger[];
    expect(Object.fromEntries(current.map((t) => [t.event, t.stageKey]))).toMatchObject({
      prospect_created: "new",
      email_delivered: "contacted",
      email_bounced: "bad_data",
      spam_blocked: null,
      unsubscribed: "do_not_contact",
      replied: "replied",
      interested: "interested",
      unresponsive: "unresponsive",
    });
    const payload = { triggers: current.map(({ event, stageKey }) => ({ event, stageKey })) };
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).put("/api/v1/stage_triggers", { data: payload });
      expect(res.status(), role).toBe(expected(role, "stage:manage"));
    }
    for (const bad of [
      { triggers: [{ event: "website_visit", stageKey: "new" }] },
      { triggers: [{ event: "replied", stageKey: "hot" }] },
      { triggers: [] },
    ]) {
      expect((await owner.put("/api/v1/stage_triggers", { data: bad })).status()).toBe(422);
    }
    expect((await owner.put("/api/v1/stage_triggers", { headers: EVIL_ORIGIN, data: payload })).status()).toBe(403);
    expect((await (await anonymous()).get("/api/v1/stage_triggers")).status()).toBe(401);
  });

  test("person created → the configured stage (fresh workspace), recorded as an automatic change", async () => {
    const ws = await freshWorkspace();
    const put = await ws.api.put("/api/v1/stage_triggers", {
      data: { triggers: [{ event: "prospect_created", stageKey: "contacted" }] },
    });
    expect(put.status(), await put.text()).toBe(200);
    const created = await ws.api.post("/api/v1/contacts", {
      data: { firstName: "Trigger", email: `${uniq("pc")}@example.test` },
    });
    expect(created.status(), await created.text()).toBe(201);
    const body = await created.json();
    const id = (body.contact ?? body.created_contacts?.[0] ?? body).id as string;
    await expect.poll(() => stageOf(id), { timeout: 15_000 }).toBe("contacted");
    const { rows } = await pg().query<{ metadata: { manual: boolean; cause: string } }>(
      "select metadata from activity where contact_id = $1 and type = 'stage_changed' order by occurred_at desc limit 1",
      [id],
    );
    expect(rows[0]?.metadata).toMatchObject({ manual: false, cause: "prospect_created" });

    // A stage given at creation is kept.
    const explicit = await ws.api.post("/api/v1/contacts", {
      data: { firstName: "Explicit", email: `${uniq("pc")}@example.test`, stage: "interested" },
    });
    const explicitBody = await explicit.json();
    const explicitId = (explicitBody.contact ?? explicitBody).id as string;
    await new Promise((r) => setTimeout(r, 1000));
    expect(await stageOf(explicitId)).toBe("interested");
  });

  test("email sent through Mailpit → Approaching", async () => {
    const api = await apiAsRole("owner");
    const sequenceId = await readySequence(api, "none");
    const contact = await createContact("acme", { firstName: "Sent", stage: "new" });
    await enrollAndRun(api, sequenceId, [contact]);
    await expect.poll(() => stageOf(contact), { timeout: 20_000 }).toBe("contacted");
  });

  test("reply recorded with mark_replied → Replied", async () => {
    const api = await apiAsRole("owner");
    const sequenceId = await readySequence(api, "all");
    const contact = await createContact("acme", { firstName: "Replier", stage: "new" });
    await enrollAndRun(api, sequenceId, [contact]);
    const res = await api.post(`/api/v1/emailer_campaigns/${sequenceId}/mark_replied`, {
      data: { contactIds: [contact] },
    });
    expect(res.status(), await res.text()).toBe(200);
    await expect.poll(() => stageOf(contact), { timeout: 20_000 }).toBe("replied");
  });

  test("unsubscribe link → Do not contact, except protected stages set by hand", async () => {
    const api = await apiAsRole("owner");
    const sequenceId = await readySequence(api, "all");
    const plain = await createContact("acme", { firstName: "Plain", stage: "new" });
    const keeper = await createContact("acme", { firstName: "Keeper", stage: "new" });
    // A person sets Interested by hand (protected), and Replied by hand (not protected).
    const manual = await api.patch(`/api/v1/contacts/${keeper}`, { data: { stage: "interested" } });
    expect(manual.status(), await manual.text()).toBe(200);
    const manualPlain = await api.patch(`/api/v1/contacts/${plain}`, { data: { stage: "replied" } });
    expect(manualPlain.status(), await manualPlain.text()).toBe(200);
    await enrollAndRun(api, sequenceId, [plain, keeper]);

    const visitor = await request.newContext();
    const res = await api.get(`/api/v1/emailer_messages/search?sequenceId=${sequenceId}&status=pending_review`);
    const messages = (await res.json()).emailer_messages as { body: string }[];
    expect(messages.length).toBe(2);
    for (const m of messages) {
      const link = m.body.match(/https?:\/\/\S+\/u\/[A-Za-z0-9_.-]+/)?.[0] as string;
      expect((await visitor.get(link)).status()).toBe(200);
    }
    await expect.poll(() => stageOf(plain), { timeout: 20_000 }).toBe("do_not_contact");
    await new Promise((r) => setTimeout(r, 1500));
    expect(await stageOf(keeper)).toBe("interested");
  });
});
