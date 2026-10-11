import { type APIRequestContext, expect, request, test } from "@playwright/test";

import { BASE_URL } from "../support/session";
import { createContact, mailpitHeaders, mailpitSearch, mailpitWaitFor, pg } from "./_engage";
import {
  acmeCompanyId,
  companyIn,
  contactIn,
  createMailbox,
  enroll,
  enrollmentStatus,
  freshWorkspace,
  mailpitFull,
  makeDue,
  messages,
  owner,
  readySequence,
  runNow,
  setPolicy,
  uniq,
} from "./_engage-parity";

const email = (subject: string, body = "Hi {{first_name}}.", extra: Record<string, unknown> = {}) => ({
  type: "auto_email",
  waitDays: 0,
  subject,
  body,
  ...extra,
});

async function acmeContacts(n: number, fields: Record<string, unknown> = {}) {
  const companyId = await acmeCompanyId();
  return Promise.all(Array.from({ length: n }, () => createContact("acme", { companyId, ...fields })));
}

/* -------------------------------------------------------------------------- */
/* Steps, variants, threading                                                 */
/* -------------------------------------------------------------------------- */

test.describe("engine: steps and variants", () => {
  test.describe.configure({ timeout: 120_000 });
  test("A/B variants alternate across contacts and record the variant on each message", async () => {
    const api = await owner();
    const marker = uniq("ab");
    const { id } = await readySequence(api, {
      steps: [
        {
          type: "auto_email",
          variants: [
            { label: "A", subject: `Alpha ${marker}`, body: "Version A for {{first_name}}" },
            { label: "B", subject: `Beta ${marker}`, body: "Version B for {{first_name}}" },
            { label: "C", subject: `Gamma ${marker}`, body: "Inactive", active: false },
          ],
        },
      ],
    });
    await enroll(api, id, await acmeContacts(4));
    expect((await runNow(api, id)).sent).toBe(4);
    const sent = await messages(api, id, "sent");
    const labels = sent.map((m) => m.variantLabel).sort();
    expect(labels).toEqual(["A", "A", "B", "B"]);
    for (const m of sent) expect(m.subject.startsWith(m.variantLabel === "A" ? "Alpha" : "Beta")).toBe(true);
    const { rows } = await pg().query<{ n: number }>(
      "select count(distinct variant_id)::int as n from outbound_message m join enrollment e on e.id = m.enrollment_id where e.sequence_id = $1",
      [id],
    );
    expect(rows[0].n).toBe(2);
    await mailpitWaitFor(`subject:"${marker}"`, 4);
    expect(await mailpitSearch(`subject:"Gamma ${marker}"`)).toHaveLength(0);
    const stats = (await (await api.get(`/api/v1/emailer_campaigns/${id}/stats`)).json()).stats;
    expect(stats.steps[0].variants.map((v: { label: string; sent: number }) => [v.label, v.sent])).toEqual([
      ["A", 2],
      ["B", 2],
      ["C", 0],
    ]);
  });

  test("steps switched off are skipped", async () => {
    const api = await owner();
    const [one, two, three] = [uniq("one"), uniq("two"), uniq("three")];
    const { id } = await readySequence(api, {
      steps: [email(one), email(two, "Skipped", { enabled: false }), email(three)],
    });
    const [contact] = await acmeContacts(1);
    await enroll(api, id, [contact]);
    expect((await runNow(api, id)).sent).toBe(1);
    expect((await runNow(api, id)).sent).toBe(1);
    await mailpitWaitFor(`subject:"${three}"`);
    expect(await mailpitSearch(`subject:"${two}"`)).toHaveLength(0);
    expect(await enrollmentStatus(api, id, contact)).toBe("finished");

    // Switching a step off after contacts reached it moves them on to the next one.
    const later = await readySequence(api, { steps: [email(uniq("x"), "Hi", { waitDays: 1 }), email(uniq("y"))] });
    const [c2] = await acmeContacts(1);
    await enroll(api, later.id, [c2]);
    const steps = (await (await api.get(`/api/v1/emailer_campaigns/${later.id}/steps`)).json()).emailer_steps;
    await api.patch(`/api/v1/emailer_campaigns/${later.id}/steps/${steps[0].id}`, { data: { enabled: false } });
    await makeDue(later.id);
    expect((await runNow(api, later.id)).skipped).toBe(1);
    expect((await runNow(api, later.id)).sent).toBe(1);
  });

  test("waits in minutes are respected", async () => {
    const api = await owner();
    const marker = uniq("wait");
    const { id } = await readySequence(api, { steps: [email(marker, "Hi", { waitMinutes: 30 })] });
    const [contact] = await acmeContacts(1);
    await enroll(api, id, [contact]);
    const { rows } = await pg().query<{ next_run_at: Date }>(
      "select next_run_at from enrollment where sequence_id = $1",
      [id],
    );
    const minutes = (rows[0].next_run_at.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(28);
    expect(minutes).toBeLessThanOrEqual(30.5);
    expect((await runNow(api, id)).sent).toBe(0);
    await makeDue(id);
    expect((await runNow(api, id)).sent).toBe(1);
    await mailpitWaitFor(`subject:"${marker}"`);
  });

  test("reply-in-thread steps reuse the subject and carry In-Reply-To and References", async () => {
    const api = await owner();
    const marker = uniq("thread");
    const { id } = await readySequence(api, {
      steps: [
        email(`Intro ${marker}`),
        { type: "auto_email", threadMode: "reply", body: "Bumping this, {{first_name}}." },
      ],
    });
    await enroll(api, id, await acmeContacts(1));
    expect((await runNow(api, id)).sent).toBe(1);
    expect((await runNow(api, id)).sent).toBe(1);
    const found = await mailpitWaitFor(`subject:"${marker}"`, 2);
    const first = found.find((m) => m.Subject === `Intro ${marker}`);
    const reply = found.find((m) => m.Subject === `Re: Intro ${marker}`);
    expect(first && reply).toBeTruthy();
    const firstFull = await mailpitFull(first?.ID ?? "");
    const headers = await mailpitHeaders(reply?.ID ?? "");
    expect(headers["In-Reply-To"]?.[0]).toContain(firstFull.MessageID);
    expect(headers.References?.[0]).toContain(firstFull.MessageID);
  });

  test("CC and BCC go to every email of the sequence", async () => {
    const api = await owner();
    const marker = uniq("cc");
    const cc = `${uniq("cc")}@example.test`;
    const bcc = `${uniq("bcc")}@example.test`;
    const { id } = await readySequence(api, { steps: [email(marker)], extra: { cc, bcc } });
    await enroll(api, id, await acmeContacts(1));
    expect((await runNow(api, id)).sent).toBe(1);
    const [mail] = await mailpitWaitFor(`subject:"${marker}"`);
    const full = await mailpitFull(mail.ID);
    expect(full.Cc?.map((a) => a.Address)).toEqual([cc]);
    expect(full.Bcc?.map((a) => a.Address)).toEqual([bcc]);
  });

  test("a schedule's windows decide when the sequence sends", async () => {
    const api = await owner();
    const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const tomorrow = days[(new Date().getUTCDay() + 1) % 7];
    const closed = await api.post("/api/v1/emailer_schedules", {
      data: { name: uniq("closed"), timezone: "UTC", windows: { [tomorrow]: [["00:00", "23:59"]] } },
    });
    expect(closed.status(), await closed.text()).toBe(201);
    const open = await api.post("/api/v1/emailer_schedules", {
      data: {
        name: uniq("open"),
        timezone: "UTC",
        windows: Object.fromEntries(days.map((d) => [d, [["00:00", "23:59"]]])),
      },
    });
    const closedId = (await closed.json()).emailer_schedule.id;
    const openId = (await open.json()).emailer_schedule.id;
    // The mailbox window is open all day: only the schedule can hold the email back.
    const marker = uniq("sched");
    const { id } = await readySequence(api, { steps: [email(marker)], extra: { scheduleId: closedId } });
    await enroll(api, id, await acmeContacts(1));
    expect(await runNow(api, id)).toMatchObject({ sent: 0, outsideWindow: 1 });
    expect(await mailpitSearch(`subject:"${marker}"`)).toHaveLength(0);
    await api.patch(`/api/v1/emailer_campaigns/${id}`, { data: { scheduleId: openId } });
    expect((await runNow(api, id)).sent).toBe(1);
    await mailpitWaitFor(`subject:"${marker}"`);
  });

  test("the sequence's 24-hour cap holds extra emails for later", async () => {
    const api = await owner();
    const marker = uniq("cap");
    const { id } = await readySequence(api, { steps: [email(marker)], extra: { maxPer24h: 1 } });
    await enroll(api, id, await acmeContacts(2));
    expect(await runNow(api, id)).toMatchObject({ sent: 1, limited: 1 });
    expect((await runNow(api, id)).sent).toBe(0);
  });

  test("ruleset email triggers mark emails not sent for contact and account stages", async () => {
    const api = await owner();
    const { id } = await readySequence(api, { steps: [email(uniq("stage"))] });
    const notInterested = await createContact("acme", { stage: "not_interested" });
    const customerCompany = (
      await pg().query<{ id: string }>(
        "insert into company (id, organization_id, name, domain, stage, source) values (gen_random_uuid()::text, (select id from organization where slug = 'acme'), $1, $2, 'customer', 'test') returning id",
        [uniq("Customer"), `${uniq("cust")}.example.test`],
      )
    ).rows[0].id;
    const customer = await createContact("acme", { companyId: customerCompany });
    await enroll(api, id, [notInterested, customer]);
    expect(await runNow(api, id)).toMatchObject({ sent: 0, blocked: 2 });
    const reasons = (await messages(api, id, "blocked")).map((m) => m.blockedReason).sort();
    expect(reasons).toEqual([
      "Not sent: the account's stage is customer.",
      "Not sent: the contact's stage is not interested.",
    ]);
    const { rows } = await pg().query("select 1 from activity where contact_id = $1 and type = 'email_not_sent'", [
      notInterested,
    ]);
    expect(rows.length).toBe(1);
  });

  test("contacts are marked unresponsive N days after the last step", async () => {
    const api = await owner();
    const { id } = await readySequence(api, {
      steps: [email(uniq("unresp"))],
      extra: { ruleset: { unresponsiveAfterDays: 3 } },
    });
    const [contact] = await acmeContacts(1);
    await enroll(api, id, [contact]);
    expect((await runNow(api, id)).sent).toBe(1);
    expect(await enrollmentStatus(api, id, contact)).toBe("finished");
    await pg().query("update enrollment set updated_at = now() - interval '4 days' where sequence_id = $1", [id]);
    expect((await runNow(api, id)).unresponsive).toBe(1);
    const { rows } = await pg().query<{ stage: string }>("select stage from contact where id = $1", [contact]);
    expect(rows[0].stage).toBe("unresponsive");
  });
});

/* -------------------------------------------------------------------------- */
/* Tracking                                                                   */
/* -------------------------------------------------------------------------- */

test.describe("engine: tracking and ruleset reactions", () => {
  test.describe.configure({ timeout: 120_000 });
  test("opens create a call task at the threshold; a click finishes the contact", async () => {
    const api = await owner();
    const marker = uniq("track");
    const { id } = await readySequence(api, {
      steps: [
        email(marker, "See https://example.com/pricing {{first_name}}"),
        email(uniq("later"), "x", { waitDays: 3 }),
      ],
      extra: {
        trackOpens: true,
        trackClicks: true,
        ruleset: { openCallTask: { enabled: true, opens: 2 }, finishOnClick: true },
      },
    });
    const [contact] = await acmeContacts(1);
    await enroll(api, id, [contact]);
    expect((await runNow(api, id)).sent).toBe(1);
    const [mail] = await mailpitWaitFor(`subject:"${marker}"`);
    const full = await mailpitFull(mail.ID);
    const pixel = full.HTML.match(/https?:\/\/[^"]+\/t\/o\/[A-Za-z0-9_.-]+/)?.[0];
    const link = full.HTML.match(/https?:\/\/[^"]+\/t\/c\/[^"]+/)?.[0]?.replace(/&amp;/g, "&");
    expect(pixel).toBeTruthy();
    expect(link).toBeTruthy();
    expect(full.Text).not.toContain("/t/c/");

    const visitor = await request.newContext();
    for (let i = 0; i < 3; i++) {
      const res = await visitor.get(pixel as string);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toBe("image/gif");
    }
    const { rows: tasks } = await pg().query<{ type: string }>(
      "select type from task where contact_id = $1 and enrollment_id is not null",
      [contact],
    );
    expect(tasks.map((t) => t.type)).toEqual(["call"]);

    const tampered = (link as string).replace(
      encodeURIComponent("https://example.com/pricing"),
      encodeURIComponent("https://evil.example"),
    );
    expect((await visitor.get(tampered, { maxRedirects: 0 })).status()).toBe(404);
    const click = await visitor.get(link as string, { maxRedirects: 0 });
    expect(click.status()).toBe(302);
    expect(click.headers().location).toBe("https://example.com/pricing");
    expect(await enrollmentStatus(api, id, contact)).toBe("finished");
    const stats = (await (await api.get(`/api/v1/emailer_campaigns/${id}/stats`)).json()).stats;
    expect(stats).toMatchObject({ opened: 1, clicked: 1 });
    expect(stats.openRate).toBe(1);
  });

  test("tracking is off by default: plain text only", async () => {
    const api = await owner();
    const marker = uniq("plain");
    const { id } = await readySequence(api, { steps: [email(marker, "Visit https://example.com")] });
    await enroll(api, id, await acmeContacts(1));
    await runNow(api, id);
    const [mail] = await mailpitWaitFor(`subject:"${marker}"`);
    const full = await mailpitFull(mail.ID);
    expect(full.HTML).toBe("");
    const visitor = await request.newContext({ baseURL: BASE_URL });
    expect((await visitor.get("/t/o/not-a-token")).status()).toBe(200);
    expect((await visitor.get("/t/c/not-a-token?u=https://evil.example", { maxRedirects: 0 })).status()).toBe(404);
  });
});

/* -------------------------------------------------------------------------- */
/* Workspace sending policies (each in its own fresh workspace)               */
/* -------------------------------------------------------------------------- */

async function workspaceSequence(
  api: APIRequestContext,
  opts: { mailbox?: Record<string, unknown>; steps?: Record<string, unknown>[]; extra?: Record<string, unknown> } = {},
) {
  return readySequence(api, { ...opts, mailbox: { email: `${uniq("ws")}@ws.test`, ...opts.mailbox } });
}

test.describe("engine: workspace sending policies", () => {
  test.describe.configure({ timeout: 180_000 });
  test("catch-all addresses are held by default; unverified ones when restricted", async () => {
    const ws = await freshWorkspace();
    const { id } = await workspaceSequence(ws.api);
    const company = await companyIn(ws.organizationId);
    const [catchAll, unverified, valid] = [
      await contactIn(ws.organizationId, { emailStatus: "catch_all", companyId: company }),
      await contactIn(ws.organizationId, { emailStatus: "unverified", companyId: company }),
      await contactIn(ws.organizationId, { emailStatus: "valid", companyId: company }),
    ];
    await enroll(ws.api, id, [catchAll, unverified, valid]);
    expect(await runNow(ws.api, id)).toMatchObject({ sent: 2, blocked: 1 });
    const blocked = await messages(ws.api, id, "blocked");
    expect(blocked.map((m) => m.blockedReason)).toEqual(["Policy: the address is on a catch-all domain."]);

    await setPolicy(ws.organizationId, { restrictUnverified: true, restrictCatchAll: false });
    const second = await workspaceSequence(ws.api);
    const [u2, c2] = [
      await contactIn(ws.organizationId, { emailStatus: "unverified", companyId: company }),
      await contactIn(ws.organizationId, { emailStatus: "catch_all", companyId: company }),
    ];
    await enroll(ws.api, second.id, [u2, c2]);
    expect(await runNow(ws.api, second.id)).toMatchObject({ sent: 1, blocked: 1 });
    expect((await messages(ws.api, second.id, "blocked"))[0].blockedReason).toBe("Policy: the address isn't verified.");
  });

  test("required signature holds sending until the mailbox has one, then appends it", async () => {
    const ws = await freshWorkspace();
    await setPolicy(ws.organizationId, { requireSignature: true });
    const marker = uniq("sig");
    const { id, mailboxId } = await workspaceSequence(ws.api, { steps: [email(marker)] });
    await enroll(ws.api, id, [await contactIn(ws.organizationId, { companyId: await companyIn(ws.organizationId) })]);
    const held = await runNow(ws.api, id);
    expect(held).toMatchObject({ ran: false, sent: 0 });
    expect(String(held.note)).toMatch(/signature/i);
    const patched = await ws.api.patch(`/api/v1/email_accounts/${mailboxId}`, {
      data: { signature: "Kim\nSales lead" },
    });
    expect(patched.status(), await patched.text()).toBe(200);
    expect((await runNow(ws.api, id)).sent).toBe(1);
    const [mail] = await mailpitWaitFor(`subject:"${marker}"`);
    expect((await mailpitFull(mail.ID)).Text).toMatch(/Kim\s*\n\s*Sales lead/);
  });

  test("the workspace daily limit caps sends across sequences", async () => {
    const ws = await freshWorkspace();
    await setPolicy(ws.organizationId, { workspaceDailyLimit: 1 });
    const company = await companyIn(ws.organizationId);
    const a = await workspaceSequence(ws.api);
    const b = await workspaceSequence(ws.api);
    await enroll(ws.api, a.id, [await contactIn(ws.organizationId, { companyId: company })]);
    await enroll(ws.api, b.id, [await contactIn(ws.organizationId, { companyId: company })]);
    expect((await runNow(ws.api, a.id)).sent).toBe(1);
    expect(await runNow(ws.api, b.id)).toMatchObject({ sent: 0, limited: 1 });
  });

  test("gradual ramp caps a new mailbox at 20 a day", async () => {
    const ws = await freshWorkspace();
    await setPolicy(ws.organizationId, { gradualRamp: true });
    const { id, mailboxId } = await workspaceSequence(ws.api, { mailbox: { dailyLimit: 200 } });
    // Twenty emails already went out from this mailbox today.
    await pg().query(
      `insert into outbound_message (id, organization_id, mailbox_id, to_email, subject, body, status, sent_at)
       select gen_random_uuid()::text, $1, $2, 'earlier@example.test', 'earlier', 'x', 'sent', now() from generate_series(1, 20)`,
      [ws.organizationId, mailboxId],
    );
    await enroll(ws.api, id, [await contactIn(ws.organizationId, { companyId: await companyIn(ws.organizationId) })]);
    expect(await runNow(ws.api, id)).toMatchObject({ sent: 0, limited: 1 });
    // Ten days in, the cap has grown past 20.
    await pg().query("update mailbox set warmup_started_at = now() - interval '10 days' where id = $1", [mailboxId]);
    expect((await runNow(ws.api, id)).sent).toBe(1);
  });

  test("bounce guard pauses a sequence over the threshold and tells its owner", async () => {
    const ws = await freshWorkspace();
    const company = await companyIn(ws.organizationId);
    const { id } = await workspaceSequence(ws.api);
    const contact = await contactIn(ws.organizationId, { companyId: company });
    await enroll(ws.api, id, [contact]);
    const { rows } = await pg().query<{ id: string }>("select id from enrollment where sequence_id = $1", [id]);
    await pg().query(
      `insert into outbound_message (id, organization_id, enrollment_id, to_email, subject, body, status, sent_at)
       select gen_random_uuid()::text, $1, $2, 'x@example.test', 'earlier', 'x',
              case when g <= 3 then 'bounced' else 'sent' end, now() - interval '1 hour'
       from generate_series(1, 20) g`,
      [ws.organizationId, rows[0].id],
    );
    const run = await runNow(ws.api, id);
    expect(run).toMatchObject({ ran: false, sent: 0 });
    expect(String(run.note)).toMatch(/bounce guard/i);
    const seq = (await (await ws.api.get(`/api/v1/emailer_campaigns/${id}`)).json()).emailer_campaign;
    expect(seq.status).toBe("paused");
    expect(seq.bounceGuardPausedAt).toBeTruthy();
    const { rows: notes } = await pg().query<{ title: string; link: string }>(
      "select title, link from notification where user_id = $1 and type = 'sequence_paused'",
      [ws.userId],
    );
    expect(notes).toHaveLength(1);
    expect(notes[0].link).toBe(`/dashboard/sequences/${id}`);
    const { rows: audits } = await pg().query(
      "select 1 from audit_log where entity_id = $1 and action = 'sequence.auto_pause'",
      [id],
    );
    expect(audits).toHaveLength(1);
    const diagnostics = (await (await ws.api.get("/api/v1/emailer_campaigns/diagnostics")).json()).diagnostics;
    expect(diagnostics.find((d: { id: string }) => d.id === id).issues.map((i: { code: string }) => i.code)).toEqual(
      expect.arrayContaining(["paused_by_bounce_guard", "high_bounce"]),
    );

    // The owner may opt this sequence out of bounce protection and resume.
    const optOut = await ws.api.patch(`/api/v1/emailer_campaigns/${id}`, {
      data: { ruleset: { ignoreBounceProtection: true } },
    });
    expect(optOut.status()).toBe(200);
    expect((await ws.api.post(`/api/v1/emailer_campaigns/${id}/approve`)).status()).toBe(200);
    expect(await runNow(ws.api, id)).toMatchObject({ ran: true, sent: 1 });
  });

  test("bounce guard can be switched off for the workspace", async () => {
    const ws = await freshWorkspace();
    await setPolicy(ws.organizationId, { bounceGuard: false });
    const { id } = await workspaceSequence(ws.api);
    await enroll(ws.api, id, [await contactIn(ws.organizationId, { companyId: await companyIn(ws.organizationId) })]);
    const { rows } = await pg().query<{ id: string }>("select id from enrollment where sequence_id = $1", [id]);
    await pg().query(
      `insert into outbound_message (id, organization_id, enrollment_id, to_email, subject, body, status, sent_at)
       select gen_random_uuid()::text, $1, $2, 'x@example.test', 'e', 'x', 'bounced', now() from generate_series(1, 12)`,
      [ws.organizationId, rows[0].id],
    );
    expect(await runNow(ws.api, id)).toMatchObject({ ran: true, sent: 1 });
  });
});

test.describe("engine: mailbox setup", () => {
  test("new mailboxes start their ramp now and accept a signature", async () => {
    const api = await owner();
    const id = await createMailbox(api, { signature: "Pat\nAcme" });
    const res = await api.get(`/api/v1/email_accounts/${id}`);
    const box = (await res.json()).email_account;
    expect(box.signature).toBe("Pat\nAcme");
    expect(Date.now() - new Date(box.warmupStartedAt).getTime()).toBeLessThan(60_000);
  });
});
