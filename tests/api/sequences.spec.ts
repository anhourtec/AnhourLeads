import { type APIRequestContext, expect, request, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";
import {
  createContact,
  mailpitHeaders,
  mailpitMailbox,
  mailpitMessage,
  mailpitSearch,
  mailpitWaitFor,
  pg,
  suppress,
  suppressionExists,
  uniq,
} from "./_engage";

const owner = () => apiAsRole("owner");

async function createMailbox(api: APIRequestContext, data: Record<string, unknown> = {}): Promise<string> {
  const res = await api.post("/api/v1/email_accounts", { data: mailpitMailbox(data) });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).email_account.id;
}

interface SequenceOptions {
  reviewMode?: "all" | "first_step" | "none";
  steps?: Record<string, unknown>[];
  mailbox?: Record<string, unknown>;
  stopOnReply?: boolean;
  activate?: boolean;
}

/** A sequence sending through Mailpit. Returns its id, mailbox id and a unique subject marker. */
async function readySequence(api: APIRequestContext, opts: SequenceOptions = {}) {
  const marker = uniq("subj");
  const mailboxId = await createMailbox(api, opts.mailbox);
  const res = await api.post("/api/v1/emailer_campaigns", {
    data: {
      name: uniq("seq"),
      mailboxId,
      reviewMode: opts.reviewMode ?? "none",
      stopOnReply: opts.stopOnReply ?? true,
      steps: opts.steps ?? [
        {
          type: "auto_email",
          waitDays: 0,
          subject: `Hello {{first_name}} ${marker}`,
          body: "Hi {{first_name}} at {{company}}.",
        },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  const id: string = body.emailer_campaign.id;
  if (opts.activate !== false) {
    const approve = await api.post(`/api/v1/emailer_campaigns/${id}/approve`);
    expect(approve.status(), await approve.text()).toBe(200);
  }
  return { id, mailboxId, marker, steps: body.emailer_steps as { id: string }[] };
}

async function enroll(api: APIRequestContext, sequenceId: string, contactIds: string[]) {
  const res = await api.post(`/api/v1/emailer_campaigns/${sequenceId}/add_contact_ids`, { data: { contactIds } });
  expect(res.status(), await res.text()).toBe(200);
  return res.json() as Promise<{ enrolled_contact_ids: string[]; skipped: { contactId: string; reason: string }[] }>;
}

async function runNow(api: APIRequestContext, sequenceId: string) {
  const res = await api.post(`/api/v1/emailer_campaigns/${sequenceId}/run_now`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).run as Record<string, number | string | boolean>;
}

async function messages(api: APIRequestContext, sequenceId: string, status?: string) {
  const qs = new URLSearchParams({ sequenceId, ...(status ? { status } : {}) });
  const res = await api.get(`/api/v1/emailer_messages/search?${qs}`);
  expect(res.status()).toBe(200);
  return (await res.json()).emailer_messages as {
    id: string;
    status: string;
    body: string;
    subject: string;
    blockedReason: string | null;
  }[];
}

async function enrollmentStatus(api: APIRequestContext, sequenceId: string, contactId: string) {
  const res = await api.get(`/api/v1/emailer_campaigns/${sequenceId}/enrollments?per_page=100`);
  const body = await res.json();
  return body.enrollments.find((e: { contact: { id: string } }) => e.contact.id === contactId)?.status as
    | string
    | undefined;
}

async function companyContact(fields: Record<string, unknown> = {}) {
  const { rows } = await pg().query<{ id: string }>(
    "select id from company where organization_id = (select id from organization where slug = 'acme') limit 1",
  );
  return createContact("acme", { firstName: "Robin", companyId: rows[0]?.id ?? null, ...fields });
}

/* -------------------------------------------------------------------------- */

test.describe("sequences (emailer_campaigns): role matrix", () => {
  test("search and create for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      expect((await api.post("/api/v1/emailer_campaigns/search", { data: {} })).status(), role).toBe(
        expected(role, "sequence:read"),
      );
      const created = await api.post("/api/v1/emailer_campaigns", { data: { name: uniq(`seq-${role}`) } });
      expect(created.status(), role).toBe(expected(role, "sequence:create", 201));
    }
  });

  test("GET, PATCH, DELETE /emailer_campaigns/[id] for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const { id } = await readySequence(await owner(), { activate: false });
      expect((await api.get(`/api/v1/emailer_campaigns/${id}`)).status(), role).toBe(expected(role, "sequence:read"));
      expect((await api.patch(`/api/v1/emailer_campaigns/${id}`, { data: { name: uniq("r") } })).status(), role).toBe(
        expected(role, "sequence:update"),
      );
      expect((await api.delete(`/api/v1/emailer_campaigns/${id}`)).status(), role).toBe(
        expected(role, "sequence:delete"),
      );
    }
  });

  test("steps CRUD and reorder for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const { id, steps } = await readySequence(await owner(), { activate: false });
      expect((await api.get(`/api/v1/emailer_campaigns/${id}/steps`)).status(), role).toBe(
        expected(role, "sequence:read"),
      );
      const add = await api.post(`/api/v1/emailer_campaigns/${id}/steps`, {
        data: { type: "call", waitDays: 2, body: "Call them" },
      });
      expect(add.status(), role).toBe(expected(role, "sequence:update", 201));
      const patch = await api.patch(`/api/v1/emailer_campaigns/${id}/steps/${steps[0].id}`, { data: { waitDays: 1 } });
      expect(patch.status(), role).toBe(expected(role, "sequence:update"));
      const put = await api.put(`/api/v1/emailer_campaigns/${id}/steps`, {
        data: {
          steps: [
            { type: "task", body: "Research" },
            { id: steps[0].id, type: "auto_email", subject: "S", body: "B" },
          ],
        },
      });
      expect(put.status(), role).toBe(expected(role, "sequence:update"));
      const del = await api.delete(`/api/v1/emailer_campaigns/${id}/steps/${steps[0].id}`);
      expect(del.status(), role).toBe(expected(role, "sequence:update"));
    }
  });

  test("approve, abort, archive for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const { id } = await readySequence(await owner(), { activate: false });
      expect((await api.post(`/api/v1/emailer_campaigns/${id}/approve`)).status(), role).toBe(
        expected(role, "sequence:launch"),
      );
      expect((await api.post(`/api/v1/emailer_campaigns/${id}/abort`)).status(), role).toBe(
        expected(role, "sequence:launch"),
      );
      expect((await api.post(`/api/v1/emailer_campaigns/${id}/archive`)).status(), role).toBe(
        expected(role, "sequence:launch"),
      );
    }
  });

  test("enrollment endpoints for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const { id } = await readySequence(await owner(), { reviewMode: "all" });
      const contact = await createContact("acme");
      const add = await api.post(`/api/v1/emailer_campaigns/${id}/add_contact_ids`, {
        data: { contactIds: [contact] },
      });
      expect(add.status(), role).toBe(expected(role, "sequence:launch"));
      if (!add.ok()) await enroll(await owner(), id, [contact]);
      expect((await api.get(`/api/v1/emailer_campaigns/${id}/enrollments`)).status(), role).toBe(
        expected(role, "sequence:read"),
      );
      expect((await api.get(`/api/v1/emailer_campaigns/${id}/stats`)).status(), role).toBe(
        expected(role, "sequence:read"),
      );
      expect((await api.get(`/api/v1/emailer_campaigns/${id}/candidates?q=Test`)).status(), role).toBe(
        expected(role, "sequence:launch"),
      );
      expect((await api.post(`/api/v1/emailer_campaigns/${id}/run_now`)).status(), role).toBe(
        expected(role, "sequence:launch"),
      );
      const stop = await api.post("/api/v1/emailer_campaigns/remove_or_stop_contact_ids", {
        data: { sequenceIds: [id], contactIds: [contact], mode: "stop" },
      });
      expect(stop.status(), role).toBe(expected(role, "sequence:launch"));
      const resume = await api.post(`/api/v1/emailer_campaigns/${id}/resume_contact_ids`, {
        data: { contactIds: [contact] },
      });
      expect(resume.status(), role).toBe(expected(role, "sequence:launch"));
      const replied = await api.post(`/api/v1/emailer_campaigns/${id}/mark_replied`, {
        data: { contactIds: [contact] },
      });
      expect(replied.status(), role).toBe(expected(role, "sequence:launch"));
    }
  });

  test("message review endpoints for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const boss = await owner();
      const { id } = await readySequence(boss, { reviewMode: "all" });
      const [a, b] = [await companyContact(), await companyContact()];
      await enroll(boss, id, [a, b]);
      await runNow(boss, id);
      const pending = await messages(boss, id, "pending_review");
      expect(pending).toHaveLength(2);
      expect((await api.get("/api/v1/emailer_messages/search?status=pending_review")).status(), role).toBe(
        expected(role, "sequence:read"),
      );
      expect((await api.post(`/api/v1/emailer_messages/${pending[0].id}/approve`)).status(), role).toBe(
        expected(role, "sequence:launch"),
      );
      expect((await api.post(`/api/v1/emailer_messages/${pending[1].id}/send_now`)).status(), role).toBe(
        expected(role, "sequence:launch"),
      );
    }
  });

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    expect((await api.post("/api/v1/emailer_campaigns/search", { data: {} })).status()).toBe(401);
    expect((await api.post("/api/v1/emailer_campaigns", { data: { name: "x" } })).status()).toBe(401);
    expect((await api.get("/api/v1/emailer_campaigns/x")).status()).toBe(401);
    expect((await api.post("/api/v1/emailer_campaigns/x/run_now")).status()).toBe(401);
    expect((await api.get("/api/v1/emailer_messages/search")).status()).toBe(401);
    expect((await api.post("/api/v1/emailer_messages/x/approve")).status()).toBe(401);
  });

  test("cross-site cookie writes are refused", async () => {
    const api = await owner();
    const evil = { origin: "https://evil.example" };
    expect(
      (await api.post(`${BASE_URL}/api/v1/emailer_campaigns`, { headers: evil, data: { name: uniq("x") } })).status(),
    ).toBe(403);
    const { id } = await readySequence(api, { activate: false });
    expect((await api.post(`/api/v1/emailer_campaigns/${id}/approve`, { headers: evil })).status()).toBe(403);
    expect(
      (
        await api.post(`/api/v1/emailer_campaigns/${id}/add_contact_ids`, {
          headers: evil,
          data: { contactIds: [await createContact("acme")] },
        })
      ).status(),
    ).toBe(403);
    expect((await api.post(`/api/v1/emailer_campaigns/${id}/run_now`, { headers: evil })).status()).toBe(403);
  });
});

/* -------------------------------------------------------------------------- */

test.describe("sequences: validation", () => {
  test("invalid input is 422", async () => {
    const api = await owner();
    const create = async (data: Record<string, unknown>) =>
      (await api.post("/api/v1/emailer_campaigns", { data })).status();
    expect(await create({})).toBe(422);
    expect(await create({ name: "x", reviewMode: "sometimes" })).toBe(422);
    expect(await create({ name: "x", steps: [{ type: "auto_email", body: "no subject" }] })).toBe(422);
    expect(await create({ name: "x", steps: [{ type: "fax" }] })).toBe(422);
    expect(await create({ name: "x", steps: [{ type: "call", waitDays: -1 }] })).toBe(422);
    expect(await create({ name: "x", mailboxId: "not-a-mailbox" })).toBe(422);

    // Activation needs steps and a mailbox that can send.
    const empty = await (await api.post("/api/v1/emailer_campaigns", { data: { name: uniq("empty") } })).json();
    expect((await api.post(`/api/v1/emailer_campaigns/${empty.emailer_campaign.id}/approve`)).status()).toBe(422);
    const noAddress = await readySequence(api, { activate: false, mailbox: { postalAddress: null } });
    const refused = await api.post(`/api/v1/emailer_campaigns/${noAddress.id}/approve`);
    expect(refused.status()).toBe(422);
    expect((await refused.json()).error).toMatch(/postal address/i);
    const noSmtp = await readySequence(api, { activate: false, mailbox: { smtpHost: null } });
    expect((await api.post(`/api/v1/emailer_campaigns/${noSmtp.id}/approve`)).status()).toBe(422);

    // Steps: unknown ids, bad bodies.
    const { id } = await readySequence(api, { activate: false });
    expect(
      (
        await api.put(`/api/v1/emailer_campaigns/${id}/steps`, { data: { steps: [{ id: "nope", type: "call" }] } })
      ).status(),
    ).toBe(422);
    expect((await api.post(`/api/v1/emailer_campaigns/${id}/steps`, { data: { type: "auto_email" } })).status()).toBe(
      422,
    );
    expect(
      (
        await api.post("/api/v1/emailer_campaigns/remove_or_stop_contact_ids", {
          data: { sequenceIds: [id], contactIds: ["x"], mode: "explode" },
        })
      ).status(),
    ).toBe(422);
    expect(
      (await api.post(`/api/v1/emailer_campaigns/${id}/add_contact_ids`, { data: { contactIds: [] } })).status(),
    ).toBe(422);
  });

  test("steps reorder keeps ids and renumbers positions", async () => {
    const api = await owner();
    const { id, steps } = await readySequence(api, { activate: false });
    const res = await api.put(`/api/v1/emailer_campaigns/${id}/steps`, {
      data: {
        steps: [
          { type: "call", waitDays: 1, body: "Call" },
          { id: steps[0].id, type: "auto_email", waitDays: 2, subject: "S", body: "B" },
        ],
      },
    });
    expect(res.status()).toBe(200);
    const list = (await res.json()).emailer_steps as { id: string; position: number; type: string }[];
    expect(list.map((s) => [s.position, s.type])).toEqual([
      [1, "call"],
      [2, "auto_email"],
    ]);
    expect(list[1].id).toBe(steps[0].id);
    const del = await api.delete(`/api/v1/emailer_campaigns/${id}/steps/${list[0].id}`);
    expect((await del.json()).emailer_steps.map((s: { position: number }) => s.position)).toEqual([1]);
  });
});

/* -------------------------------------------------------------------------- */

test.describe("sequences: enrollment rules", () => {
  test("skips suppressed, invalid, missing-email, do-not-contact and duplicate contacts", async () => {
    const api = await owner();
    const { id } = await readySequence(api, { activate: false });
    const domain = `${uniq("blocked")}.example.test`;
    const okId = await createContact("acme");
    const suppressedEmail = `${uniq("sup")}@example.test`;
    const suppressedEmailId = await createContact("acme", { email: suppressedEmail });
    await suppress("acme", "email", suppressedEmail);
    const suppressedDomainId = await createContact("acme", { email: `someone@${domain}` });
    await suppress("acme", "domain", domain);
    const invalidId = await createContact("acme", { emailStatus: "invalid" });
    const disposableId = await createContact("acme", { emailStatus: "disposable" });
    const noEmailId = await createContact("acme", { email: null });
    const dncId = await createContact("acme", { stage: "do_not_contact" });
    const globexId = await createContact("globex");

    const first = await enroll(api, id, [
      okId,
      suppressedEmailId,
      suppressedDomainId,
      invalidId,
      disposableId,
      noEmailId,
      dncId,
      globexId,
      "missing-id",
    ]);
    expect(first.enrolled_contact_ids).toEqual([okId]);
    const reasons = Object.fromEntries(first.skipped.map((s) => [s.contactId, s.reason]));
    expect(reasons).toEqual({
      [suppressedEmailId]: "suppressed_email",
      [suppressedDomainId]: "suppressed_domain",
      [invalidId]: "invalid_email",
      [disposableId]: "disposable_email",
      [noEmailId]: "missing_email",
      [dncId]: "do_not_contact",
      [globexId]: "not_found",
      "missing-id": "not_found",
    });

    const again = await enroll(api, id, [okId]);
    expect(again.enrolled_contact_ids).toEqual([]);
    expect(again.skipped).toMatchObject([{ contactId: okId, reason: "already_enrolled" }]);

    const list = await (await api.get(`/api/v1/emailer_campaigns/${id}/enrollments`)).json();
    expect(list.pagination.total_entries).toBe(1);
    expect(list.enrollments[0].contact).toMatchObject({ id: okId });
  });

  test("remove, stop, finish and resume", async () => {
    const api = await owner();
    const { id } = await readySequence(api, { activate: false });
    const [a, b, c] = [await createContact("acme"), await createContact("acme"), await createContact("acme")];
    await enroll(api, id, [a, b, c]);
    const call = (contactIds: string[], mode: string) =>
      api.post("/api/v1/emailer_campaigns/remove_or_stop_contact_ids", {
        data: { sequenceIds: [id], contactIds, mode },
      });
    expect((await (await call([a], "stop")).json()).updated).toBe(1);
    expect((await (await call([b], "finish")).json()).updated).toBe(1);
    expect((await (await call([c], "remove")).json()).updated).toBe(1);
    expect(await enrollmentStatus(api, id, a)).toBe("paused");
    expect(await enrollmentStatus(api, id, b)).toBe("finished");
    expect(await enrollmentStatus(api, id, c)).toBe("removed");
    const resumed = await api.post(`/api/v1/emailer_campaigns/${id}/resume_contact_ids`, {
      data: { contactIds: [a, b] },
    });
    expect((await resumed.json()).updated).toBe(1);
    expect(await enrollmentStatus(api, id, a)).toBe("active");
    const stats = await (await api.get(`/api/v1/emailer_campaigns/${id}/stats`)).json();
    expect(stats.stats).toMatchObject({ enrolled: 2, active: 1, finished: 1 });
  });
});

/* -------------------------------------------------------------------------- */

test.describe("sequences: sending engine", () => {
  test("sends through the mailbox with merge fields, sender identification and unsubscribe", async () => {
    const api = await owner();
    const { id, marker } = await readySequence(api);
    const contact = await companyContact();
    await enroll(api, id, [contact]);
    const run = await runNow(api, id);
    expect(run).toMatchObject({ ran: true, sent: 1, blocked: 0 });

    const [summary] = await mailpitWaitFor(`subject:"${marker}"`);
    expect(summary.Subject).toBe(`Hello Robin ${marker}`);
    const message = await mailpitMessage(summary.ID);
    expect(message.Text).toContain("Hi Robin at ");
    expect(message.Text).not.toContain("{{");
    expect(message.Text).toContain("1 Test Street, Springfield, 12345");
    expect(message.Text).toContain("Acme Sender");
    const link = message.Text.match(/https?:\/\/\S+\/u\/[A-Za-z0-9_.-]+/)?.[0];
    expect(link).toBeTruthy();
    const headers = await mailpitHeaders(summary.ID);
    expect(headers["List-Unsubscribe"]?.[0]).toBe(`<${link}>`);
    expect(headers["List-Unsubscribe-Post"]?.[0]).toBe("List-Unsubscribe=One-Click");

    const stats = (await (await api.get(`/api/v1/emailer_campaigns/${id}/stats`)).json()).stats;
    expect(stats).toMatchObject({ enrolled: 1, sent: 1, finished: 1 });
    expect(stats.steps[0].sent).toBe(1);
    expect(await enrollmentStatus(api, id, contact)).toBe("finished");
  });

  test("running twice at once sends each step only once", async () => {
    const api = await owner();
    const { id, marker } = await readySequence(api);
    await enroll(api, id, [await companyContact(), await companyContact()]);
    const [r1, r2] = await Promise.all([
      api.post(`/api/v1/emailer_campaigns/${id}/run_now`),
      api.post(`/api/v1/emailer_campaigns/${id}/run_now`),
    ]);
    const sent = [(await r1.json()).run.sent, (await r2.json()).run.sent];
    expect(sent.reduce((a, b) => a + b, 0)).toBe(2);
    const third = await runNow(api, id);
    expect(third.sent).toBe(0);
    await mailpitWaitFor(`subject:"${marker}"`, 2);
    expect(await mailpitSearch(`subject:"${marker}"`)).toHaveLength(2);
  });

  test("review mode holds messages until approved", async () => {
    const api = await owner();
    const { id, marker } = await readySequence(api, { reviewMode: "all" });
    const contact = await companyContact();
    await enroll(api, id, [contact]);
    const run = await runNow(api, id);
    expect(run).toMatchObject({ sent: 0, pendingReview: 1 });
    const [pending] = await messages(api, id, "pending_review");
    expect(pending.subject).toBe(`Hello Robin ${marker}`);
    expect(pending.body).toContain("/u/");
    expect(await mailpitSearch(`subject:"${marker}"`)).toHaveLength(0);

    // Running again neither duplicates the review item nor sends it.
    expect((await runNow(api, id)).pendingReview).toBe(0);
    expect(await messages(api, id)).toHaveLength(1);

    const approve = await api.post(`/api/v1/emailer_messages/${pending.id}/approve`);
    expect(approve.status()).toBe(200);
    expect((await approve.json()).emailer_message.status).toBe("queued");
    expect((await api.post(`/api/v1/emailer_messages/${pending.id}/approve`)).status()).toBe(422);
    expect((await runNow(api, id)).sent).toBe(1);
    await mailpitWaitFor(`subject:"${marker}"`);
    expect((await messages(api, id, "sent")).map((m) => m.id)).toEqual([pending.id]);
  });

  test("first-step review only holds step one; send now sends immediately", async () => {
    const api = await owner();
    const marker2 = uniq("second");
    const { id, marker } = await readySequence(api, {
      reviewMode: "first_step",
      steps: [
        { type: "auto_email", waitDays: 0, subject: `One {{first_name}} ${uniq("x")}`, body: "First" },
        { type: "auto_email", waitDays: 0, subject: `Two ${marker2}`, body: "Second" },
      ],
    });
    void marker;
    const contact = await companyContact();
    await enroll(api, id, [contact]);
    expect((await runNow(api, id)).pendingReview).toBe(1);
    const [pending] = await messages(api, id, "pending_review");
    const sent = await api.post(`/api/v1/emailer_messages/${pending.id}/send_now`);
    expect(sent.status(), await sent.text()).toBe(200);
    expect((await sent.json()).emailer_message.status).toBe("sent");
    expect((await runNow(api, id)).sent).toBe(1);
    await mailpitWaitFor(`subject:"${marker2}"`);
    expect(await enrollmentStatus(api, id, contact)).toBe("finished");
  });

  test("the daily limit holds extra sends for later", async () => {
    const api = await owner();
    const { id, marker } = await readySequence(api, { mailbox: { dailyLimit: 1 } });
    await enroll(api, id, [await companyContact(), await companyContact()]);
    const run = await runNow(api, id);
    expect(run).toMatchObject({ sent: 1, limited: 1 });
    expect((await runNow(api, id)).sent).toBe(0);
    await mailpitWaitFor(`subject:"${marker}"`);
    expect(await mailpitSearch(`subject:"${marker}"`)).toHaveLength(1);
    const mailboxes = await (await api.get("/api/v1/email_accounts")).json();
    expect(
      mailboxes.email_accounts.find(
        (m: { dailyLimit: number; sentToday: number; id: string }) => m.dailyLimit === 1 && m.sentToday === 1,
      ),
    ).toBeTruthy();
  });

  test("outside the sending window nothing is sent", async () => {
    const api = await owner();
    const now = new Date();
    const hour = (now.getUTCHours() + 12) % 24;
    const hh = String(hour).padStart(2, "0");
    const { id, marker } = await readySequence(api, {
      mailbox: { sendingWindowStart: `${hh}:00`, sendingWindowEnd: `${hh}:30`, timezone: "UTC" },
    });
    await enroll(api, id, [await companyContact()]);
    expect(await runNow(api, id)).toMatchObject({ sent: 0, outsideWindow: 1 });
    expect(await mailpitSearch(`subject:"${marker}"`)).toHaveLength(0);
  });

  test("missing merge fields and send-time suppression block the message", async () => {
    const api = await owner();
    const { id } = await readySequence(api);
    const noName = await createContact("acme", { firstName: null });
    const laterSuppressed = await companyContact();
    await enroll(api, id, [noName, laterSuppressed]);
    const { rows } = await pg().query<{ email: string }>("select email from contact where id = $1", [laterSuppressed]);
    await suppress("acme", "email", rows[0].email);

    expect(await runNow(api, id)).toMatchObject({ sent: 0, blocked: 2 });
    const blocked = await messages(api, id, "blocked");
    const reasons = blocked.map((m) => m.blockedReason ?? "");
    expect(reasons.some((r) => /merge field.*first_name/i.test(r))).toBe(true);
    expect(reasons.some((r) => /suppressed/i.test(r))).toBe(true);
    expect(blocked.every((m) => !m.subject.includes("{{") || m.blockedReason)).toBe(true);
    expect(await enrollmentStatus(api, id, noName)).toBe("paused");
    expect((await runNow(api, id)).blocked).toBe(0);
  });

  test("call and task steps create tasks and advance", async () => {
    const api = await owner();
    const { id, marker } = await readySequence(api, {
      steps: [
        { type: "call", waitDays: 0, body: "Call {{first_name}}" },
        { type: "auto_email", waitDays: 0, subject: `After call {{first_name}} ${uniq("m")}`, body: "Hi" },
      ],
    });
    void marker;
    const contact = await companyContact();
    await enroll(api, id, [contact]);
    expect(await runNow(api, id)).toMatchObject({ tasks: 1, sent: 0 });
    const { rows } = await pg().query<{ type: string; note: string; assignee_id: string | null }>(
      "select type, note, assignee_id from task where contact_id = $1",
      [contact],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "call", note: "Call Robin" });
    expect(rows[0].assignee_id).toBeTruthy();
    expect((await runNow(api, id)).sent).toBe(1);
  });

  test("stop on reply holds pending messages and ends the enrollment", async () => {
    const api = await owner();
    const { id } = await readySequence(api, { reviewMode: "all" });
    const contact = await companyContact();
    await enroll(api, id, [contact]);
    await runNow(api, id);
    const replied = await api.post(`/api/v1/emailer_campaigns/${id}/mark_replied`, { data: { contactIds: [contact] } });
    expect((await replied.json()).updated).toBe(1);
    expect(await enrollmentStatus(api, id, contact)).toBe("replied");
    const all = await messages(api, id);
    expect(all.map((m) => m.status)).toEqual(["blocked"]);
    expect((await runNow(api, id)).pendingReview).toBe(0);
    const stats = (await (await api.get(`/api/v1/emailer_campaigns/${id}/stats`)).json()).stats;
    expect(stats.replied).toBe(1);
  });

  test("paused sequences don't send", async () => {
    const api = await owner();
    const { id, marker } = await readySequence(api);
    await enroll(api, id, [await companyContact()]);
    await api.post(`/api/v1/emailer_campaigns/${id}/abort`);
    const run = await runNow(api, id);
    expect(run.ran).toBe(false);
    expect(await mailpitSearch(`subject:"${marker}"`)).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */

test.describe("unsubscribe link", () => {
  test("one click without signing in suppresses the email and stops enrollments", async () => {
    const api = await owner();
    const first = await readySequence(api, { reviewMode: "all" });
    const second = await readySequence(api, { reviewMode: "all" });
    const contact = await companyContact();
    await enroll(api, first.id, [contact]);
    await enroll(api, second.id, [contact]);
    await runNow(api, first.id);
    const [pending] = await messages(api, first.id, "pending_review");
    const link = pending.body.match(/https?:\/\/\S+\/u\/[A-Za-z0-9_.-]+/)?.[0];
    expect(link).toBeTruthy();

    const visitor = await request.newContext();
    const res = await visitor.get(link as string);
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain("unsubscribed");

    const { rows } = await pg().query<{ email: string }>("select email from contact where id = $1", [contact]);
    expect(await suppressionExists("acme", rows[0].email)).toBe("unsubscribed");
    expect(await enrollmentStatus(api, first.id, contact)).toBe("unsubscribed");
    expect(await enrollmentStatus(api, second.id, contact)).toBe("unsubscribed");
    expect((await messages(api, first.id, "blocked")).map((m) => m.id)).toEqual([pending.id]);

    // Repeat clicks and the RFC 8058 one-click POST are harmless.
    expect((await visitor.get(link as string)).status()).toBe(200);
    expect((await visitor.post(link as string, { form: { "List-Unsubscribe": "One-Click" } })).status()).toBe(200);

    // Re-enrolling is refused.
    const third = await readySequence(api, { activate: false });
    const again = await enroll(api, third.id, [contact]);
    expect(again.skipped[0]?.reason).toBe("suppressed_email");
  });

  test("forged or malformed tokens get 404", async () => {
    const visitor = await request.newContext({ baseURL: BASE_URL });
    expect((await visitor.get("/u/not-a-token")).status()).toBe(404);
    expect((await visitor.post("/u/not-a-token")).status()).toBe(404);
    const forged = `${Buffer.from("org:contact").toString("base64url")}.${Buffer.alloc(32).toString("base64url")}`;
    expect((await visitor.get(`/u/${forged}`)).status()).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */

test.describe("sequences: workspace isolation", () => {
  test.describe.configure({ timeout: 180_000 });
  test("Globex can't see or act on Acme sequences, steps or messages", async () => {
    const acme = await owner();
    const { id, steps } = await readySequence(acme, { reviewMode: "all" });
    const contact = await companyContact();
    await enroll(acme, id, [contact]);
    await runNow(acme, id);
    const [pending] = await messages(acme, id, "pending_review");

    const globex = await apiAs(GLOBEX_OWNER);
    const paths = [
      ["get", `/api/v1/emailer_campaigns/${id}`],
      ["patch", `/api/v1/emailer_campaigns/${id}`],
      ["delete", `/api/v1/emailer_campaigns/${id}`],
      ["get", `/api/v1/emailer_campaigns/${id}/steps`],
      ["post", `/api/v1/emailer_campaigns/${id}/steps`],
      ["put", `/api/v1/emailer_campaigns/${id}/steps`],
      ["patch", `/api/v1/emailer_campaigns/${id}/steps/${steps[0].id}`],
      ["delete", `/api/v1/emailer_campaigns/${id}/steps/${steps[0].id}`],
      ["post", `/api/v1/emailer_campaigns/${id}/approve`],
      ["post", `/api/v1/emailer_campaigns/${id}/abort`],
      ["post", `/api/v1/emailer_campaigns/${id}/archive`],
      ["post", `/api/v1/emailer_campaigns/${id}/add_contact_ids`],
      ["post", `/api/v1/emailer_campaigns/${id}/mark_replied`],
      ["post", `/api/v1/emailer_campaigns/${id}/resume_contact_ids`],
      ["post", `/api/v1/emailer_campaigns/${id}/run_now`],
      ["get", `/api/v1/emailer_campaigns/${id}/enrollments`],
      ["get", `/api/v1/emailer_campaigns/${id}/stats`],
      ["get", `/api/v1/emailer_campaigns/${id}/candidates`],
      ["post", `/api/v1/emailer_messages/${pending.id}/approve`],
      ["post", `/api/v1/emailer_messages/${pending.id}/send_now`],
    ] as const;
    const bodies: Record<string, unknown> = {
      patch: { name: "taken" },
      post: { contactIds: [contact], type: "call" },
      put: { steps: [] },
    };
    for (const [method, path] of paths) {
      const res = await globex[method](path, { data: bodies[method] });
      expect(res.status(), `${method} ${path}`).toBe(404);
    }
    const stop = await globex.post("/api/v1/emailer_campaigns/remove_or_stop_contact_ids", {
      data: { sequenceIds: [id], contactIds: [contact], mode: "remove" },
    });
    expect(stop.status()).toBe(404);

    const search = await (await globex.post("/api/v1/emailer_campaigns/search", { data: {} })).json();
    expect(search.emailer_campaigns.some((s: { id: string }) => s.id === id)).toBe(false);
    const msgs = await (await globex.get("/api/v1/emailer_messages/search")).json();
    expect(msgs.emailer_messages.some((m: { id: string }) => m.id === pending.id)).toBe(false);

    // Globex can't enroll Acme contacts into its own sequence either.
    const own = await (await globex.post("/api/v1/emailer_campaigns", { data: { name: uniq("g") } })).json();
    const steal = await enroll(globex, own.emailer_campaign.id, [contact]);
    expect(steal.skipped[0]?.reason).toBe("not_found");

    // Acme's data is untouched.
    expect((await acme.get(`/api/v1/emailer_campaigns/${id}`)).status()).toBe(200);
    expect(await messages(acme, id, "pending_review")).toHaveLength(1);
  });
});
