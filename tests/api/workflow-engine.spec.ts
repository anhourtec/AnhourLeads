import "dotenv/config";

import { type APIRequestContext, expect, test } from "@playwright/test";

import { apiAsRole } from "../support/session";
import { createContact, pg, uniq } from "./_engage";
import { addFreshMember } from "./admin-helpers";
import { createHmac } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";

test.describe.configure({ timeout: 240_000 });

interface Run {
  id: string;
  entityId: string;
  status: string;
  resumeAt: string | null;
  log: { type: string; status: string; message: string }[];
}

const owner = () => apiAsRole("owner");

async function newList(api: APIRequestContext, name = uniq("wf-list")): Promise<string> {
  const res = await api.post("/api/v1/labels", { data: { name, entityType: "contact" } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).label.id;
}

async function workflow(api: APIRequestContext, data: Record<string, unknown>, launch = true): Promise<string> {
  const res = await api.post("/api/v1/workflows", { data: { name: uniq("Engine"), ...data } });
  expect(res.status(), await res.text()).toBe(201);
  const id = (await res.json()).workflow.id as string;
  if (launch) {
    const launched = await api.post(`/api/v1/workflows/${id}/launch`);
    expect(launched.status(), await launched.text()).toBe(200);
  }
  return id;
}

async function runs(api: APIRequestContext, id: string): Promise<Run[]> {
  const res = await api.get(`/api/v1/workflows/${id}/runs?per_page=100`);
  expect(res.status()).toBe(200);
  return (await res.json()).runs;
}

async function newContactViaApi(api: APIRequestContext, title: string): Promise<string> {
  const res = await api.post("/api/v1/contacts", {
    data: { firstName: "Flow", lastName: uniq("p"), title, email: `${uniq("flow")}@example.test` },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).contact.id;
}

const inList = async (listId: string, contactId: string) =>
  (await pg().query("select 1 from list_member where list_id = $1 and entity_id = $2", [listId, contactId])).rowCount ??
  0;
const tasksFor = async (contactId: string) =>
  (await pg().query<{ title: string }>("select title from task where contact_id = $1", [contactId])).rows.map(
    (r) => r.title,
  );

async function archive(api: APIRequestContext, id: string) {
  await api.post(`/api/v1/workflows/${id}/archive`);
}

test.describe("workflow engine", () => {
  test("event trigger enrolls a matching person and runs add-to-list + create-task; others are ignored", async () => {
    const api = await owner();
    const marker = uniq("ICP");
    const listId = await newList(api);
    const id = await workflow(api, {
      triggerType: "event",
      triggerEvent: "contact_created",
      enrollmentFilters: { title: marker },
      blocks: [
        { id: "l", type: "add_to_list", config: { listId } },
        { id: "t", type: "create_task", config: { title: `Reach out ${marker}`, taskType: "call", dueInDays: 0 } },
      ],
    });
    const match = await newContactViaApi(api, `Head of ${marker}`);
    const other = await newContactViaApi(api, "Unrelated title");
    await expect.poll(() => inList(listId, match), { timeout: 20_000 }).toBe(1);
    await expect.poll(() => tasksFor(match), { timeout: 20_000 }).toEqual([`Reach out ${marker}`]);
    expect(await inList(listId, other)).toBe(0);
    const all = await runs(api, id);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ entityId: match, status: "completed" });
    expect(all[0].log.map((l) => l.type)).toEqual(["enrolled", "add_to_list", "create_task", "completed"]);

    // One run per record at a time; with re-enrollment off a record never runs twice.
    await api.patch(`/api/v1/workflows/${id}`, { data: { allowReenroll: false } });
    await api.patch(`/api/v1/contacts/${match}`, { data: { title: `Head of ${marker} again` } });
    await new Promise((r) => setTimeout(r, 1000));
    expect(await runs(api, id)).toHaveLength(1);
    await archive(api, id);
  });

  test("delay waits with a resume time, then run_due resumes it", async () => {
    const api = await owner();
    const marker = uniq("Delay");
    const id = await workflow(api, {
      triggerEvent: "contact_created",
      enrollmentFilters: { title: marker },
      blocks: [
        { id: "d", type: "delay", config: { amount: 2, unit: "hours" } },
        { id: "t", type: "create_task", config: { title: `After the wait ${marker}` } },
      ],
    });
    const contact = await newContactViaApi(api, marker);
    await expect.poll(async () => (await runs(api, id))[0]?.status, { timeout: 20_000 }).toBe("waiting");
    const [waiting] = await runs(api, id);
    const resumeAt = new Date(waiting.resumeAt as string).getTime();
    expect(resumeAt - Date.now()).toBeGreaterThan(110 * 60_000);
    expect(await tasksFor(contact)).toEqual([]);

    // Not due yet: nothing happens.
    expect((await (await api.post(`/api/v1/workflows/${id}/run_due`)).json()).processed.resumed).toBe(0);
    // Time passes (fixture): the resume time is now in the past.
    await pg().query("update workflow_run set resume_at = now() - interval '1 minute' where id = $1", [waiting.id]);
    const due = await api.post(`/api/v1/workflows/${id}/run_due`);
    expect(due.status(), await due.text()).toBe(200);
    expect((await due.json()).processed.resumed).toBe(1);
    expect((await runs(api, id))[0].status).toBe("completed");
    expect(await tasksFor(contact)).toEqual([`After the wait ${marker}`]);
    await archive(api, id);
  });

  test("true/false branch sends each person down the matching path", async () => {
    const api = await owner();
    const marker = uniq("Branch");
    const yesList = await newList(api);
    const noList = await newList(api);
    const id = await workflow(api, {
      triggerEvent: "contact_created",
      enrollmentFilters: { title: marker },
      blocks: [
        {
          id: "b",
          type: "branch_if",
          config: { match: "all", conditions: [{ field: "title", op: "contains", value: "VP" }] },
          branches: {
            yes: [{ id: "y", type: "add_to_list", config: { listId: yesList } }],
            no: [
              { id: "n", type: "add_to_list", config: { listId: noList } },
              { id: "x", type: "exit", config: {} },
            ],
          },
        },
      ],
    });
    const vp = await newContactViaApi(api, `VP ${marker}`);
    const ic = await newContactViaApi(api, `Engineer ${marker}`);
    await expect.poll(() => inList(yesList, vp), { timeout: 20_000 }).toBe(1);
    await expect.poll(() => inList(noList, ic), { timeout: 20_000 }).toBe(1);
    expect(await inList(noList, vp)).toBe(0);
    expect(await inList(yesList, ic)).toBe(0);
    const statuses = Object.fromEntries((await runs(api, id)).map((r) => [r.entityId, r.status]));
    expect(statuses).toEqual({ [vp]: "completed", [ic]: "exited" });

    // The dry run reports the same path without changing anything.
    const dry = await (await api.post(`/api/v1/workflows/${id}/test`, { data: { entityId: vp } })).json();
    expect(dry.test.path.map((p: { outcome: string }) => p.outcome)).toEqual(["yes", "would run"]);
    await archive(api, id);
  });

  test("schedule trigger enrolls only the filtered set; traffic split spreads them across paths", async () => {
    const api = await owner();
    const tag = uniq("sched");
    const listA = await newList(api);
    const listB = await newList(api);
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push(await createContact("acme", { firstName: `S${i}`, title: `Buyer ${tag}` }));
    const outsider = await createContact("acme", { firstName: "Out", title: "Someone else" });
    const id = await workflow(api, {
      triggerType: "schedule",
      schedule: { at: new Date(Date.now() - 1000).toISOString(), timezone: "UTC" },
      enrollmentFilters: { title: tag },
      blocks: [
        {
          id: "s",
          type: "split_traffic",
          config: {
            splits: [
              { key: "a", percent: 50 },
              { key: "b", percent: 50 },
            ],
          },
          branches: {
            a: [{ id: "la", type: "add_to_list", config: { listId: listA } }],
            b: [{ id: "lb", type: "add_to_list", config: { listId: listB } }],
          },
        },
      ],
    });
    const due = await api.post(`/api/v1/workflows/${id}/run_due`);
    expect(due.status(), await due.text()).toBe(200);
    expect((await due.json()).processed.enrolled).toBe(30);
    const { rows } = await pg().query<{ list_id: string; n: number }>(
      "select list_id, count(*)::int as n from list_member where list_id = any($1) group by list_id",
      [[listA, listB]],
    );
    const counts = Object.fromEntries(rows.map((r) => [r.list_id, r.n]));
    expect((counts[listA] ?? 0) + (counts[listB] ?? 0)).toBe(30);
    expect(counts[listA] ?? 0).toBeGreaterThanOrEqual(4);
    expect(counts[listB] ?? 0).toBeGreaterThanOrEqual(4);
    expect(await inList(listA, outsider)).toBe(0);
    expect(await inList(listB, outsider)).toBe(0);
    // The occurrence ran once: a second pass enrolls nobody.
    expect((await (await api.post(`/api/v1/workflows/${id}/run_due`)).json()).processed.enrolled).toBe(0);
    await archive(api, id);
  });

  test("webhook: POSTs the record as signed JSON to a local endpoint", async () => {
    const api = await owner();
    const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        received.push({ headers: req.headers, body });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    try {
      const marker = uniq("Hook");
      const secret = "local-test-signing-secret";
      const id = await workflow(api, {
        triggerEvent: "contact_created",
        enrollmentFilters: { title: marker },
        blocks: [{ id: "w", type: "webhook", config: { url: `http://127.0.0.1:${port}/hook`, secret } }],
      });
      const contact = await newContactViaApi(api, marker);
      await expect.poll(() => received.length, { timeout: 20_000 }).toBe(1);
      const [hit] = received;
      const payload = JSON.parse(hit.body);
      expect(payload).toMatchObject({
        event: "workflow.webhook",
        workflow: { id },
        record: { type: "contact", id: contact },
      });
      expect(payload.record.organizationId).toBeUndefined();
      const ts = hit.headers["x-anhour-timestamp"] as string;
      const expectedSig = `sha256=${createHmac("sha256", secret).update(`${ts}.${hit.body}`).digest("hex")}`;
      expect(hit.headers["x-anhour-signature"]).toBe(expectedSig);
      await expect.poll(async () => (await runs(api, id))[0]?.status, { timeout: 10_000 }).toBe("completed");
      expect((await runs(api, id))[0].log.find((l) => l.type === "webhook")).toMatchObject({ status: "ok" });
      await archive(api, id);
    } finally {
      server.close();
    }
  });

  test("runs fail with a clear message when the workflow's owner loses permission", async () => {
    const admin = await apiAsRole("admin");
    const member = await addFreshMember(admin, "member", "wfowner");
    const marker = uniq("Perm");
    const listId = await newList(member.api);
    const id = await workflow(member.api, {
      triggerEvent: "contact_created",
      enrollmentFilters: { title: marker },
      blocks: [{ id: "l", type: "add_to_list", config: { listId } }],
    });
    const demote = await admin.patch(`/api/v1/users/${member.userId}`, { data: { role: "viewer" } });
    expect(demote.status(), await demote.text()).toBe(200);
    const api = await owner();
    const contact = await newContactViaApi(api, marker);
    await expect.poll(async () => (await runs(api, id))[0]?.status, { timeout: 20_000 }).toBe("failed");
    const [run] = await runs(api, id);
    expect(run.log.at(-1)?.message).toContain("no longer has permission");
    expect(await inList(listId, contact)).toBe(0);
    await archive(api, id);
  });
});
