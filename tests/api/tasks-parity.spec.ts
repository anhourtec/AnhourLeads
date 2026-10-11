import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { createContact, pg } from "./_engage";
import {
  acmeCompanyId,
  EVIL,
  enroll,
  freshAcmeMember,
  owner,
  readySequence,
  runNow,
  uniq,
  userId,
} from "./_engage-parity";

async function task(data: Record<string, unknown> = {}) {
  const api = await owner();
  const res = await api.post("/api/v1/tasks", {
    data: { title: uniq("Task"), type: "call", assigneeId: await userId(ACME.member), ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).task as { id: string; title: string };
}

test.describe("tasks parity: role matrix", () => {
  test("counts and associations for every role; log_call per task:update", async () => {
    const contact = await createContact("acme");
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      expect((await api.get("/api/v1/tasks/counts?mine=true")).status(), role).toBe(expected(role, "task:read"));
      expect((await api.get("/api/v1/tasks/associations?q=Test")).status(), role).toBe(expected(role, "task:read"));
      const t = await task({ contactId: contact });
      const res = await api.post(`/api/v1/tasks/${t.id}/log_call`, {
        data: { outcome: "voicemail", note: "Left a message" },
      });
      expect(res.status(), role).toBe(expected(role, "task:update"));
    }
  });

  test("401, CSRF 403, Globex 404 and 422", async () => {
    const anon = await anonymous();
    expect((await anon.get("/api/v1/tasks/counts")).status()).toBe(401);
    expect((await anon.get("/api/v1/tasks/associations")).status()).toBe(401);
    expect((await anon.post("/api/v1/tasks/x/log_call", { data: { outcome: "connected" } })).status()).toBe(401);
    const api = await owner();
    const t = await task();
    expect(
      (await api.post(`/api/v1/tasks/${t.id}/log_call`, { headers: EVIL, data: { outcome: "connected" } })).status(),
    ).toBe(403);
    expect((await api.post(`/api/v1/tasks/${t.id}/log_call`, { data: { outcome: "busy" } })).status()).toBe(422);
    expect((await api.post(`/api/v1/tasks/${t.id}/log_call`, { data: {} })).status()).toBe(422);
    expect((await api.post("/api/v1/tasks", { data: { title: "x", type: "linkedin_poke" } })).status()).toBe(422);
    expect((await api.post("/api/v1/tasks", { data: { title: "x", dealId: "not-a-deal" } })).status()).toBe(422);
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.post(`/api/v1/tasks/${t.id}/log_call`, { data: { outcome: "connected" } })).status()).toBe(
      404,
    );
    const theirs = (await (await globex.get(`/api/v1/tasks/associations?q=`)).json()).associations;
    const { rows } = await pg().query<{ id: string }>(
      "select id from contact where organization_id = (select id from organization where slug = 'acme') limit 50",
    );
    const acmeIds = new Set(rows.map((r) => r.id));
    expect(theirs.some((a: { id: string }) => acmeIds.has(a.id))).toBe(false);
    // A completed task can't be logged again.
    expect((await api.post(`/api/v1/tasks/${t.id}/log_call`, { data: { outcome: "connected" } })).status()).toBe(200);
    expect((await api.post(`/api/v1/tasks/${t.id}/log_call`, { data: { outcome: "connected" } })).status()).toBe(422);
  });
});

test.describe("tasks parity: behaviour", () => {
  test("tab counts and tab search: call, email, LinkedIn (all LinkedIn types) and overdue", async () => {
    const fresh = await freshAcmeMember("member");
    const make = (type: string, dueAt?: string) =>
      fresh.api.post("/api/v1/tasks", { data: { title: uniq(type), type, ...(dueAt ? { dueAt } : {}) } });
    const past = new Date(Date.now() - 86_400_000).toISOString();
    for (const [type, due] of [
      ["call", past],
      ["call", undefined],
      ["email", undefined],
      ["linkedin_connect", undefined],
      ["linkedin_interact", past],
      ["action_item", undefined],
    ] as const) {
      expect((await make(type, due)).status()).toBe(201);
    }
    const counts = (await (await fresh.api.get("/api/v1/tasks/counts?mine=true&status=open")).json()).counts;
    expect(counts).toEqual({ all: 6, call: 2, email: 1, linkedin: 2, overdue: 2 });
    const linkedin = await (
      await fresh.api.post("/api/v1/tasks/search", { data: { mine: true, tab: "linkedin" } })
    ).json();
    expect(linkedin.tasks.map((t: { type: string }) => t.type).sort()).toEqual([
      "linkedin_connect",
      "linkedin_interact",
    ]);
    const overdue = await (
      await fresh.api.post("/api/v1/tasks/search", { data: { mine: true, tab: "overdue" } })
    ).json();
    expect(overdue.tasks).toHaveLength(2);
    expect(overdue.tasks.every((t: { overdue: boolean }) => t.overdue)).toBe(true);
    const byTitle = await (
      await fresh.api.post("/api/v1/tasks/search", { data: { mine: true, sort: "title" } })
    ).json();
    const titles: string[] = byTitle.tasks.map((t: { title: string }) => t.title);
    expect(titles[0]).toMatch(/^action_item/);
    expect(titles[titles.length - 1]).toMatch(/^linkedin/);
  });

  test("tasks link to deals and companies; create and complete record timeline events", async () => {
    const api = await owner();
    const companyId = await acmeCompanyId();
    const deal = await api.post("/api/v1/opportunities", { data: { name: uniq("Deal"), companyId } });
    expect(deal.status(), await deal.text()).toBe(201);
    const dealId = (await deal.json()).opportunity.id as string;
    const res = await api.post("/api/v1/tasks", {
      data: { title: uniq("Deal follow-up"), type: "linkedin_message", companyId, dealId, priority: "high" },
    });
    expect(res.status(), await res.text()).toBe(201);
    const created = (await res.json()).task;
    expect(created).toMatchObject({ type: "linkedin_message", dealId, company: { id: companyId } });
    const done = await api.post(`/api/v1/tasks/${created.id}/complete`, { data: {} });
    expect(done.status()).toBe(200);
    const { rows } = await pg().query<{ type: string }>(
      "select type from activity where metadata->>'taskId' = $1 order by occurred_at",
      [created.id],
    );
    expect(rows.map((r) => r.type)).toEqual(["task_created", "task_completed"]);
    const byDeal = await (await api.post("/api/v1/tasks/search", { data: { dealId } })).json();
    expect(byDeal.tasks.map((t: { id: string }) => t.id)).toEqual([created.id]);
  });

  test("call session: logging a call completes the task and records call_logged on the contact", async () => {
    const contact = await createContact("acme", { firstName: "Linus" });
    const t = await task({ contactId: contact, note: "Ask about renewals" });
    const member = await apiAsRole("member");
    const res = await member.post(`/api/v1/tasks/${t.id}/log_call`, {
      data: { outcome: "connected", note: "Interested" },
    });
    expect(res.status(), await res.text()).toBe(200);
    const done = (await res.json()).task;
    expect(done.status).toBe("completed");
    expect(done.note).toContain("Call outcome: Connected");
    expect(done.note).toContain("Interested");
    const { rows } = await pg().query<{ type: string; metadata: { outcome: string } }>(
      "select type, metadata from activity where contact_id = $1 and type in ('call_logged', 'task_completed') order by occurred_at",
      [contact],
    );
    expect(rows.map((r) => r.type)).toEqual(["task_completed", "call_logged"]);
    expect(rows[1].metadata.outcome).toBe("connected");
  });

  test("associations search spans contacts and companies", async () => {
    const api = await owner();
    const name = uniq("Zed");
    await createContact("acme", { firstName: name });
    const { rows } = await pg().query<{ id: string }>(
      "insert into company (id, organization_id, name, domain, source) values (gen_random_uuid()::text, (select id from organization where slug = 'acme'), $1, $2, 'test') returning id",
      [`${name} Industries`, `${name.toLowerCase()}.example.test`],
    );
    const found = (await (await api.get(`/api/v1/tasks/associations?q=${encodeURIComponent(name)}`)).json())
      .associations;
    expect(found.map((a: { kind: string }) => a.kind).sort()).toEqual(["company", "contact"]);
    expect(found.find((a: { kind: string }) => a.kind === "company").id).toBe(rows[0].id);
  });

  test("LinkedIn sequence steps create tasks of the matching type, linked to the enrollment", async () => {
    const api = await owner();
    const { id } = await readySequence(api, {
      steps: [
        { type: "linkedin_view", waitDays: 0 },
        { type: "linkedin_connect", waitDays: 0, body: "Connect with {{first_name}}" },
      ],
    });
    const contact = await createContact("acme", { firstName: "Ola", companyId: await acmeCompanyId() });
    await enroll(api, id, [contact]);
    expect((await runNow(api, id)).tasks).toBe(1);
    expect((await runNow(api, id)).tasks).toBe(1);
    const { rows } = await pg().query<{ type: string; enrollment_id: string | null; note: string | null }>(
      "select type, enrollment_id, note from task where contact_id = $1 order by created_at",
      [contact],
    );
    expect(rows.map((r) => r.type)).toEqual(["linkedin_view", "linkedin_connect"]);
    expect(rows.every((r) => r.enrollment_id)).toBe(true);
    expect(rows[1].note).toBe("Connect with Ola");
  });
});
