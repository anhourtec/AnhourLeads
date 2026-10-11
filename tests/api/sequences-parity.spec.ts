import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { createContact, mailpitWaitFor, pg } from "./_engage";
import {
  acmeCompanyId,
  createMailbox,
  EVIL,
  enroll,
  enrollmentStatus,
  freshAcmeMember,
  owner,
  readySequence,
  runNow,
  setOnboardedWithoutConsent,
  uniq,
} from "./_engage-parity";

/* -------------------------------------------------------------------------- */
/* Role matrix                                                                */
/* -------------------------------------------------------------------------- */

test.describe("sequences parity: role matrix", () => {
  test.describe.configure({ timeout: 420_000 });
  test("workspace views (analytics, diagnostics, tags) and drafting for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      for (const path of ["analytics", "diagnostics", "tags"]) {
        expect((await api.get(`/api/v1/emailer_campaigns/${path}`)).status(), `${role} ${path}`).toBe(
          expected(role, "sequence:read"),
        );
      }
      const gen = await api.post("/api/v1/emailer_campaigns/generate", {
        data: { audience: "Heads of sales", goal: "Book a demo", steps: 4, tone: "direct" },
      });
      expect(gen.status(), role).toBe(expected(role, "sequence:create"));
      const tpl = await api.post("/api/v1/emailer_campaigns/generate", { data: { template: "multichannel" } });
      expect(tpl.status(), role).toBe(expected(role, "sequence:create"));
    }
  });

  test("per-sequence reads, drafts, preview, clone, test email and list enrollment for every role", async () => {
    const boss = await owner();
    const contact = await createContact("acme");
    const listId = crypto.randomUUID();
    const { rows } = await pg().query<{ id: string }>("select id from organization where slug = 'acme'");
    await pg().query("insert into list (id, organization_id, name, entity_type) values ($1, $2, $3, 'contact')", [
      listId,
      rows[0].id,
      uniq("list"),
    ]);
    await pg().query("insert into list_member (list_id, entity_id) values ($1, $2)", [listId, contact]);
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const { id } = await readySequence(boss, { activate: false });
      for (const path of ["health", "optimize", "activity", "stats", "enrollments"]) {
        expect((await api.get(`/api/v1/emailer_campaigns/${id}/${path}`)).status(), `${role} ${path}`).toBe(
          expected(role, "sequence:read"),
        );
      }
      const preview = await api.post(`/api/v1/emailer_campaigns/${id}/preview`, {
        data: { contactId: contact, subject: "Hi {{first_name}}", body: "Hello {{first_name}}" },
      });
      expect(preview.status(), `${role} preview`).toBe(expected(role, "sequence:read"));
      const draft = await api.post(`/api/v1/emailer_campaigns/${id}/draft`, {
        data: { mode: "assisted", kind: "follow_up", tone: "casual", personalization: ["persona"] },
      });
      expect(draft.status(), `${role} draft`).toBe(expected(role, "sequence:update"));
      const testEmail = await api.post(`/api/v1/emailer_campaigns/${id}/test_email`, {
        data: { subject: "Test {{first_name}}", body: "Body for {{first_name}}" },
      });
      expect(testEmail.status(), `${role} test_email`).toBe(expected(role, "sequence:update"));
      const clone = await api.post(`/api/v1/emailer_campaigns/${id}/clone`);
      expect(clone.status(), `${role} clone`).toBe(expected(role, "sequence:create", 201));
      const addList = await api.post(`/api/v1/emailer_campaigns/${id}/add_list`, { data: { listId } });
      expect(addList.status(), `${role} add_list`).toBe(expected(role, "sequence:launch"));
    }
  });

  test("consent endpoints are open to every member, for themselves", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      expect((await api.get("/api/v1/consents/anti-spam")).status(), role).toBe(200);
      const res = await api.post("/api/v1/consents/anti-spam", { data: { accepted: true } });
      expect(res.status(), role).toBe(200);
      expect((await res.json()).anti_spam).toMatchObject({ required: false });
    }
  });

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    for (const path of ["analytics", "diagnostics", "tags", "x/health", "x/optimize", "x/activity"]) {
      expect((await api.get(`/api/v1/emailer_campaigns/${path}`)).status(), path).toBe(401);
    }
    for (const path of ["generate", "x/clone", "x/preview", "x/draft", "x/test_email", "x/add_list"]) {
      expect((await api.post(`/api/v1/emailer_campaigns/${path}`, { data: {} })).status(), path).toBe(401);
    }
    expect((await api.get("/api/v1/consents/anti-spam")).status()).toBe(401);
    expect((await api.post("/api/v1/consents/anti-spam", { data: { accepted: true } })).status()).toBe(401);
  });

  test("cross-site cookie writes are refused", async () => {
    const api = await owner();
    const { id } = await readySequence(api, { activate: false });
    for (const path of [`${id}/clone`, `${id}/draft`, `${id}/test_email`, `${id}/add_list`, "generate"]) {
      expect((await api.post(`/api/v1/emailer_campaigns/${path}`, { headers: EVIL, data: {} })).status(), path).toBe(
        403,
      );
    }
    expect(
      (await api.patch(`/api/v1/emailer_campaigns/${id}`, { headers: EVIL, data: { starred: true } })).status(),
    ).toBe(403);
    expect((await api.post("/api/v1/consents/anti-spam", { headers: EVIL, data: { accepted: true } })).status()).toBe(
      403,
    );
  });

  test("Globex gets 404 for Acme sequence endpoints", async () => {
    const { id } = await readySequence(await owner(), { activate: false });
    const globex = await apiAs(GLOBEX_OWNER);
    for (const path of ["health", "optimize", "activity"]) {
      expect((await globex.get(`/api/v1/emailer_campaigns/${id}/${path}`)).status(), path).toBe(404);
    }
    const contact = await createContact("acme");
    for (const [path, data] of [
      ["clone", {}],
      ["preview", { contactId: contact }],
      ["draft", { mode: "assisted" }],
      ["test_email", { body: "x" }],
      ["add_list", { listId: "x" }],
    ] as const) {
      expect((await globex.post(`/api/v1/emailer_campaigns/${id}/${path}`, { data })).status(), path).toBe(404);
    }
    const analytics = await (await globex.get("/api/v1/emailer_campaigns/analytics")).json();
    expect(analytics.analytics.some((s: { id: string }) => s.id === id)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

test.describe("sequences parity: validation", () => {
  test("invalid steps, settings and drafts are 422", async () => {
    const api = await owner();
    const create = async (data: Record<string, unknown>) =>
      (await api.post("/api/v1/emailer_campaigns", { data: { name: uniq("v"), ...data } })).status();
    expect(await create({ steps: [{ type: "auto_email", subject: "s", body: "b", waitMinutes: 1440 }] })).toBe(422);
    expect(
      await create({
        steps: [{ type: "auto_email", variants: [{ label: "A", subject: "s", body: "b", active: false }] }],
      }),
    ).toBe(422);
    expect(
      await create({
        steps: [
          {
            type: "auto_email",
            variants: [
              { label: "A", subject: "s", body: "b" },
              { label: "a", subject: "s", body: "b" },
            ],
          },
        ],
      }),
    ).toBe(422);
    expect(await create({ steps: [{ type: "auto_email", threadMode: "sideways", subject: "s", body: "b" }] })).toBe(
      422,
    );
    // Reply-in-thread steps may leave the subject empty; new threads may not.
    expect(await create({ steps: [{ type: "auto_email", threadMode: "reply", body: "b" }] })).toBe(201);
    expect(await create({ cc: "not an email" })).toBe(422);
    expect(await create({ maxPer24h: 0 })).toBe(422);
    expect(await create({ ruleset: { sameAccountReply: "explode" } })).toBe(422);
    expect(await create({ ruleset: { notSentContactStages: ["vip"] } })).toBe(422);
    expect(await create({ ownerId: "not-a-member" })).toBe(422);
    expect(await create({ scheduleId: "not-a-schedule" })).toBe(422);

    // A Globex schedule can't be used by an Acme sequence.
    const globex = await apiAs(GLOBEX_OWNER);
    const schedules = await (await globex.get("/api/v1/emailer_schedules")).json();
    expect(await create({ scheduleId: schedules.emailer_schedules[0].id })).toBe(422);

    const { id } = await readySequence(api, { activate: false });
    const post = async (path: string, data: Record<string, unknown>) =>
      (await api.post(`/api/v1/emailer_campaigns/${id}/${path}`, { data })).status();
    expect(await post("draft", { mode: "prompt" })).toBe(422);
    expect(await post("draft", { mode: "chat" })).toBe(422);
    expect(await post("preview", { subject: "x" })).toBe(422);
    expect(await post("test_email", { body: "   " })).toBe(422);
    expect(await post("add_list", {})).toBe(422);
    expect(
      (await api.post("/api/v1/emailer_campaigns/generate", { data: { audience: "a", goal: "b", steps: 1 } })).status(),
    ).toBe(422);
    expect((await api.post("/api/v1/consents/anti-spam", { data: { accepted: false } })).status()).toBe(422);
  });

  test("only managers and above may turn off bounce protection", async () => {
    const { id } = await readySequence(await owner(), { activate: false });
    const member = await apiAsRole("member");
    const refused = await member.patch(`/api/v1/emailer_campaigns/${id}`, {
      data: { ruleset: { ignoreBounceProtection: true } },
    });
    expect(refused.status()).toBe(403);
    const manager = await apiAsRole("manager");
    const ok = await manager.patch(`/api/v1/emailer_campaigns/${id}`, {
      data: { ruleset: { ignoreBounceProtection: true } },
    });
    expect(ok.status(), await ok.text()).toBe(200);
    expect((await ok.json()).emailer_campaign.ruleset.ignoreBounceProtection).toBe(true);
    // Members can still save other ruleset fields without touching it.
    const other = await member.patch(`/api/v1/emailer_campaigns/${id}`, {
      data: { ruleset: { sameAccountReply: "finish", ignoreBounceProtection: true } },
    });
    expect(other.status(), await other.text()).toBe(200);
  });
});

/* -------------------------------------------------------------------------- */
/* Anti-spam acknowledgement                                                  */
/* -------------------------------------------------------------------------- */

test.describe("sequences parity: anti-spam acknowledgement", () => {
  test("someone who onboarded without accepting must accept before creating a sequence", async () => {
    const fresh = await freshAcmeMember("member");
    await setOnboardedWithoutConsent("acme", fresh.userId);
    const state = await (await fresh.api.get("/api/v1/consents/anti-spam")).json();
    expect(state.anti_spam).toEqual({ required: true, acceptedAt: null });
    const refused = await fresh.api.post("/api/v1/emailer_campaigns", { data: { name: uniq("first") } });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error).toMatch(/anti-spam/i);

    const accept = await fresh.api.post("/api/v1/consents/anti-spam", { data: { accepted: true } });
    expect(accept.status()).toBe(200);
    expect((await accept.json()).anti_spam.required).toBe(false);
    const created = await fresh.api.post("/api/v1/emailer_campaigns", { data: { name: uniq("first") } });
    expect(created.status(), await created.text()).toBe(201);
    const { rows } = await pg().query<{ anti_spam_accepted_at: Date | null }>(
      "select anti_spam_accepted_at from onboarding_state where user_id = $1",
      [fresh.userId],
    );
    expect(rows[0].anti_spam_accepted_at).toBeTruthy();
  });

  test("accounts without an onboarding row (seeded or older) are not asked", async () => {
    const fresh = await freshAcmeMember("member");
    await pg().query("delete from onboarding_state where user_id = $1", [fresh.userId]);
    const state = await (await fresh.api.get("/api/v1/consents/anti-spam")).json();
    expect(state.anti_spam.required).toBe(false);
    const created = await fresh.api.post("/api/v1/emailer_campaigns", { data: { name: uniq("legacy") } });
    expect(created.status(), await created.text()).toBe(201);
  });
});

/* -------------------------------------------------------------------------- */
/* Behaviour                                                                  */
/* -------------------------------------------------------------------------- */

test.describe("sequences parity: behaviour", () => {
  test("settings, tags, star, owner, schedule and ruleset round-trip; search filters by them", async () => {
    const api = await owner();
    const tag = uniq("tag");
    const schedules = await (await api.get("/api/v1/emailer_schedules")).json();
    const schedule = schedules.emailer_schedules[0];
    const { id } = await readySequence(api, { activate: false });
    const res = await api.patch(`/api/v1/emailer_campaigns/${id}`, {
      data: {
        description: "For heads of sales",
        tags: [tag, tag],
        starred: true,
        scheduleId: schedule.id,
        cc: "cc@example.test",
        bcc: "audit@example.test",
        maxPer24h: 40,
        trackOpens: true,
        ruleset: {
          sameAccountReply: "pause",
          openCallTask: { enabled: true, opens: 2 },
          unresponsiveAfterDays: 7,
          notSentContactStages: ["do_not_contact"],
          notSentAccountStages: [],
        },
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const seq = (await res.json()).emailer_campaign;
    expect(seq).toMatchObject({
      description: "For heads of sales",
      tags: [tag],
      starred: true,
      schedule: { id: schedule.id },
      cc: "cc@example.test",
      maxPer24h: 40,
      ruleset: {
        sameAccountReply: "pause",
        openCallTask: { enabled: true, opens: 2 },
        unresponsiveAfterDays: 7,
        finishOnClick: false,
        notSentContactStages: ["do_not_contact"],
        notSentAccountStages: [],
      },
    });
    expect(seq.owner?.email).toBe("owner@acme.test");
    const search = await (await api.post("/api/v1/emailer_campaigns/search", { data: { tag, starred: true } })).json();
    expect(search.emailer_campaigns.map((s: { id: string }) => s.id)).toEqual([id]);
    expect((await (await api.get("/api/v1/emailer_campaigns/tags")).json()).tags).toContain(tag);
  });

  test("variants, step switches, waits and thread mode are stored and returned", async () => {
    const api = await owner();
    const { id } = await readySequence(api, {
      activate: false,
      steps: [
        {
          type: "auto_email",
          waitMinutes: 30,
          variants: [
            { label: "A", subject: "Version A", body: "Body A" },
            { label: "B", subject: "Version B", body: "Body B", active: false },
          ],
        },
        { type: "auto_email", waitDays: 2, threadMode: "reply", body: "Follow up", enabled: false },
        { type: "linkedin_interact", waitDays: 1, body: "Like a recent post" },
      ],
    });
    const steps = (await (await api.get(`/api/v1/emailer_campaigns/${id}/steps`)).json()).emailer_steps;
    expect(steps[0]).toMatchObject({ waitMinutes: 30, subject: "Version A", enabled: true });
    expect(steps[0].variants.map((v: { label: string; active: boolean }) => [v.label, v.active])).toEqual([
      ["A", true],
      ["B", false],
    ]);
    expect(steps[1]).toMatchObject({ threadMode: "reply", enabled: false, waitDays: 2 });
    expect(steps[2]).toMatchObject({ type: "linkedin_interact" });

    // Updating one step keeps its versions unless they are passed.
    const patched = await api.patch(`/api/v1/emailer_campaigns/${id}/steps/${steps[0].id}`, {
      data: { waitMinutes: 45 },
    });
    expect(patched.status(), await patched.text()).toBe(200);
    const after = (await patched.json()).emailer_steps[0];
    expect(after.waitMinutes).toBe(45);
    expect(after.variants.map((v: { id: string }) => v.id)).toEqual(steps[0].variants.map((v: { id: string }) => v.id));

    // Replacing the list can drop a version.
    const put = await api.put(`/api/v1/emailer_campaigns/${id}/steps`, {
      data: {
        steps: [
          {
            id: steps[0].id,
            type: "auto_email",
            variants: [{ id: steps[0].variants[0].id, label: "A", subject: "A2", body: "B2" }],
          },
        ],
      },
    });
    expect(put.status(), await put.text()).toBe(200);
    const replaced = (await put.json()).emailer_steps;
    expect(replaced).toHaveLength(1);
    expect(replaced[0].variants).toHaveLength(1);
    expect(replaced[0]).toMatchObject({ subject: "A2", body: "B2" });
  });

  test("clone copies settings and steps into a new draft", async () => {
    const api = await owner();
    const { id } = await readySequence(api, {
      steps: [
        {
          type: "auto_email",
          variants: [
            { label: "A", subject: "S", body: "B" },
            { label: "B", subject: "S2", body: "B2" },
          ],
        },
        { type: "call", waitDays: 2 },
      ],
      extra: { tags: ["clone-me"] },
    });
    const res = await api.post(`/api/v1/emailer_campaigns/${id}/clone`);
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.emailer_campaign).toMatchObject({ status: "draft", tags: ["clone-me"] });
    expect(body.emailer_campaign.name).toMatch(/^Copy of /);
    expect(body.emailer_steps.map((s: { type: string }) => s.type)).toEqual(["auto_email", "call"]);
    expect(body.emailer_steps[0].variants).toHaveLength(2);
    expect(body.emailer_campaign.stats.enrolled).toBe(0);
  });

  test("an out-of-office reply pauses the contact instead of finishing it", async () => {
    const api = await owner();
    const { id } = await readySequence(api, { reviewMode: "all" });
    const contact = await createContact("acme", { companyId: await acmeCompanyId() });
    await enroll(api, id, [contact]);
    const res = await api.post(`/api/v1/emailer_campaigns/${id}/mark_replied`, {
      data: { contactIds: [contact], subject: "Out of office: back on Monday" },
    });
    expect(await res.json()).toMatchObject({ updated: 1, outOfOffice: true });
    expect(await enrollmentStatus(api, id, contact)).toBe("paused");
    const viaHeader = await api.post(`/api/v1/emailer_campaigns/${id}/resume_contact_ids`, {
      data: { contactIds: [contact] },
    });
    expect(viaHeader.status()).toBe(200);
    const auto = await api.post(`/api/v1/emailer_campaigns/${id}/mark_replied`, {
      data: { contactIds: [contact], subject: "Re: hello", headers: { "Auto-Submitted": "auto-replied" } },
    });
    expect((await auto.json()).outOfOffice).toBe(true);
    const real = await api.post(`/api/v1/emailer_campaigns/${id}/resume_contact_ids`, {
      data: { contactIds: [contact] },
    });
    expect(real.status()).toBe(200);
    const reply = await api.post(`/api/v1/emailer_campaigns/${id}/mark_replied`, {
      data: { contactIds: [contact], subject: "Re: hello" },
    });
    expect(await reply.json()).toMatchObject({ updated: 1, outOfOffice: false });
    expect(await enrollmentStatus(api, id, contact)).toBe("replied");
    const { rows } = await pg().query("select 1 from activity where contact_id = $1 and type = 'email_replied'", [
      contact,
    ]);
    expect(rows.length).toBe(1);
  });

  test("a reply finishes colleagues at the same account when the ruleset says so", async () => {
    const api = await owner();
    const companyId = (
      await pg().query<{ id: string }>(
        "insert into company (id, organization_id, name, domain, source) values (gen_random_uuid()::text, (select id from organization where slug = 'acme'), $1, $2, 'test') returning id",
        [uniq("Acct"), `${uniq("acct")}.example.test`],
      )
    ).rows[0].id;
    const { id } = await readySequence(api, { reviewMode: "all", extra: { ruleset: { sameAccountReply: "finish" } } });
    const [a, b, outsider] = [
      await createContact("acme", { companyId }),
      await createContact("acme", { companyId }),
      await createContact("acme"),
    ];
    await enroll(api, id, [a, b, outsider]);
    const res = await api.post(`/api/v1/emailer_campaigns/${id}/mark_replied`, { data: { contactIds: [a] } });
    expect(await res.json()).toMatchObject({ updated: 1, sameAccount: 1 });
    expect(await enrollmentStatus(api, id, a)).toBe("replied");
    expect(await enrollmentStatus(api, id, b)).toBe("finished");
    expect(await enrollmentStatus(api, id, outsider)).toBe("active");
  });

  test("enrollments report counts per tab including not sent; activity, health and report reflect sends", async () => {
    const api = await owner();
    const { id, marker } = await readySequence(api, {
      extra: { ruleset: { notSentContactStages: ["not_interested"] } },
    });
    const ok = await createContact("acme", { companyId: await acmeCompanyId() });
    const skip = await createContact("acme", { stage: "not_interested" });
    await enroll(api, id, [ok, skip]);
    expect(await runNow(api, id)).toMatchObject({ sent: 1, blocked: 1 });
    await mailpitWaitFor(`subject:"${marker}"`);
    const list = await (await api.get(`/api/v1/emailer_campaigns/${id}/enrollments?status=not_sent`)).json();
    expect(list.enrollments.map((e: { contact: { id: string } }) => e.contact.id)).toEqual([skip]);
    expect(list.enrollments[0].notSentReason).toMatch(/Not sent/);
    expect(list.counts).toMatchObject({ not_sent: 1, finished: 1 });
    const activity = (await (await api.get(`/api/v1/emailer_campaigns/${id}/activity`)).json()).activities;
    const types = activity.map((a: { type: string }) => a.type);
    expect(types).toEqual(expect.arrayContaining(["contact_added_to_sequence", "email_sent", "email_not_sent"]));
    const health = (await (await api.get(`/api/v1/emailer_campaigns/${id}/health`)).json()).health;
    expect(health.bounce).toMatchObject({ sample: 1, bounced: 0, overThreshold: false });
    const stats = (await (await api.get(`/api/v1/emailer_campaigns/${id}/stats`)).json()).stats;
    expect(stats.steps[0]).toMatchObject({ sent: 1, blocked: 1 });
  });

  test("optimize gives deterministic suggestions", async () => {
    const api = await owner();
    const long = "A very long subject line that keeps going well past what fits on a phone screen";
    const { id } = await readySequence(api, {
      activate: false,
      steps: [
        { type: "auto_email", subject: long, body: "No personal touch at all." },
        { type: "auto_email", waitDays: 1, threadMode: "reply", body: "Hi {{first_name}}" },
      ],
    });
    const suggestions = (await (await api.get(`/api/v1/emailer_campaigns/${id}/optimize`)).json()).suggestions;
    const codes = suggestions.map((s: { code: string }) => s.code);
    expect(codes).toEqual(expect.arrayContaining(["subject_length", "personalisation", "spacing", "call_step"]));
  });

  test("drafts come from templates without an AI provider, with a notice in prompt mode", async () => {
    const api = await owner();
    const { id } = await readySequence(api, { activate: false });
    const assisted = await (
      await api.post(`/api/v1/emailer_campaigns/${id}/draft`, {
        data: { mode: "assisted", kind: "last_pitch", tone: "formal", personalization: ["company_facts"] },
      })
    ).json();
    expect(assisted.draft.body).toContain("{{first_name}}");
    expect(["template", "ai"]).toContain(assisted.draft.source);
    const prompt = await (
      await api.post(`/api/v1/emailer_campaigns/${id}/draft`, { data: { mode: "prompt", prompt: "Short intro" } })
    ).json();
    if (prompt.draft.source === "template") expect(prompt.draft.notice).toMatch(/AI provider/);
    const gen = await (
      await api.post("/api/v1/emailer_campaigns/generate", {
        data: { audience: "Founders", goal: "Try the product", steps: 5, includeCalls: true },
      })
    ).json();
    expect(gen.draft.steps).toHaveLength(5);
    expect(gen.draft.steps[0]).toMatchObject({ type: "auto_email", threadMode: "new_thread" });
    expect(gen.draft.steps.some((s: { type: string }) => s.type === "call")).toBe(true);
    // The draft can be posted as-is.
    const created = await api.post("/api/v1/emailer_campaigns", {
      data: { name: gen.draft.name, steps: gen.draft.steps },
    });
    expect(created.status(), await created.text()).toBe(201);
  });

  test("preview renders merge fields for a contact and lists missing ones", async () => {
    const api = await owner();
    const { id } = await readySequence(api, { activate: false });
    const contact = await createContact("acme", { firstName: "Ada", companyId: null });
    const res = await api.post(`/api/v1/emailer_campaigns/${id}/preview`, {
      data: { contactId: contact, subject: "Hi {{first_name}}", body: "At {{company}}" },
    });
    const { preview } = await res.json();
    expect(preview.subject).toBe("Hi Ada");
    expect(preview.missing).toEqual(["company"]);
  });

  test("send me a test email goes to the signed-in person through the sequence mailbox", async () => {
    const api = await owner();
    const mailboxId = await createMailbox(api);
    const { id } = await readySequence(api, { activate: false, mailboxId });
    const marker = uniq("test-mail");
    const res = await api.post(`/api/v1/emailer_campaigns/${id}/test_email`, {
      data: { subject: `Check {{first_name}} ${marker}`, body: "Hello {{first_name}}" },
    });
    expect(res.status(), await res.text()).toBe(200);
    expect((await res.json()).to).toBe("owner@acme.test");
    const [mail] = await mailpitWaitFor(`subject:"${marker}"`);
    expect(mail.Subject).toBe(`[Test] Check Sam ${marker}`);
    expect(mail.To[0].Address).toBe("owner@acme.test");
  });
});
