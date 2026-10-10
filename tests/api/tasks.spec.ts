import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAsRole, apiWithKey, BASE_URL } from "../support/session";
import {
  acmeKey,
  acmeKeyClient,
  acmeOrgId,
  createKey,
  EVIL_ORIGIN,
  globexApi,
  globexKey,
  insertContact,
  uniq,
  userIdOf,
} from "./admin-helpers";

async function newTask(title = uniq("Task")) {
  const owner = await apiAsRole("owner");
  const res = await owner.post("/api/v1/tasks", {
    data: { title, type: "call", priority: "high", assigneeId: await userIdOf(ACME.member) },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).task as { id: string; title: string };
}

test.describe("tasks API", () => {
  test("search: every role per matrix, unauthenticated 401", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.post("/api/v1/tasks/search", { data: {} });
      expect(res.status(), role).toBe(expected(role, "task:read"));
      if (res.ok()) {
        const body = await res.json();
        expect(Array.isArray(body.tasks)).toBe(true);
        expect(body.pagination.page).toBe(1);
      }
    }
    expect((await (await anonymous()).post("/api/v1/tasks/search", { data: {} })).status()).toBe(401);
  });

  test("search filters: mine, status, priority, due range, contact", async () => {
    const member = await apiAsRole("member");
    const memberId = await userIdOf(ACME.member);
    const contactId = await insertContact(await acmeOrgId(), { email: `${uniq("tk")}@example.com` });
    const title = uniq("Filter task");
    const due = new Date(Date.now() + 3 * 864e5).toISOString();
    const created = await member.post("/api/v1/tasks", {
      data: { title, type: "email", priority: "low", contactId, dueAt: due },
    });
    expect(created.status()).toBe(201);
    const task = (await created.json()).task;
    expect(task.assignee.id).toBe(memberId);
    expect(task.contact.id).toBe(contactId);

    const mine = await (await member.post("/api/v1/tasks/search", { data: { mine: true, per_page: 100 } })).json();
    expect(mine.tasks.every((t: { assignee: { id: string } }) => t.assignee.id === memberId)).toBe(true);

    const byContact = await (await member.post("/api/v1/tasks/search", { data: { contactId } })).json();
    expect(byContact.tasks.map((t: { id: string }) => t.id)).toEqual([task.id]);

    const filtered = await (
      await member.post("/api/v1/tasks/search", {
        data: {
          q: title,
          status: ["open"],
          priority: "low",
          type: "email",
          dueAfter: new Date(Date.now() + 2 * 864e5).toISOString(),
          dueBefore: new Date(Date.now() + 4 * 864e5).toISOString(),
        },
      })
    ).json();
    expect(filtered.tasks.map((t: { id: string }) => t.id)).toEqual([task.id]);

    const outOfRange = await (
      await member.post("/api/v1/tasks/search", { data: { q: title, dueBefore: new Date().toISOString() } })
    ).json();
    expect(outOfRange.tasks).toHaveLength(0);
  });

  test("create: every role per matrix; 422 on bad input; assignee must be a member", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.post("/api/v1/tasks", { data: { title: uniq(`by ${role}`), type: "action_item" } });
      expect(res.status(), role).toBe(expected(role, "task:create", 201));
    }
    const owner = await apiAsRole("owner");
    expect((await owner.post("/api/v1/tasks", { data: { type: "fax" } })).status()).toBe(422);
    expect((await owner.post("/api/v1/tasks", { data: { title: "x", dueAt: "not a date" } })).status()).toBe(422);
    const outsider = await owner.post("/api/v1/tasks", {
      data: { title: "x", assigneeId: await userIdOf("owner@globex.test") },
    });
    expect(outsider.status()).toBe(422);
    expect((await outsider.json()).details[0].path).toBe("assigneeId");
    const badContact = await owner.post("/api/v1/tasks", { data: { title: "x", contactId: crypto.randomUUID() } });
    expect(badContact.status()).toBe(422);
  });

  test("create without title gets one from the type and contact", async () => {
    const owner = await apiAsRole("owner");
    const contactId = await insertContact(await acmeOrgId(), { firstName: "Ada", lastName: "Lovelace" });
    const res = await owner.post("/api/v1/tasks", { data: { type: "call", contactId } });
    expect(res.status()).toBe(201);
    expect((await res.json()).task.title).toBe("Call Ada Lovelace");
  });

  test("bulk create: one per contact; per matrix; 422 when a contact is out of scope", async () => {
    const org = await acmeOrgId();
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const ids = [await insertContact(org), await insertContact(org)];
      const res = await api.post("/api/v1/tasks/bulk_create", { data: { contactIds: ids, type: "email" } });
      expect(res.status(), role).toBe(expected(role, "task:create", 201));
      if (res.ok()) {
        const body = await res.json();
        expect(body.tasks).toHaveLength(2);
        expect(body.tasks.map((t: { contact: { id: string } }) => t.contact.id).sort()).toEqual([...ids].sort());
      }
    }
    const owner = await apiAsRole("owner");
    const res = await owner.post("/api/v1/tasks/bulk_create", {
      data: { contactIds: [await insertContact(org), crypto.randomUUID()] },
    });
    expect(res.status()).toBe(422);
    expect((await owner.post("/api/v1/tasks/bulk_create", { data: { contactIds: [] } })).status()).toBe(422);
  });

  test("get, update, complete, skip, delete: every role per matrix", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const task = await newTask();
      const get = await api.get(`/api/v1/tasks/${task.id}`);
      expect(get.status(), `${role} get`).toBe(expected(role, "task:read"));

      const patch = await api.patch(`/api/v1/tasks/${task.id}`, { data: { priority: "low", note: "updated" } });
      expect(patch.status(), `${role} patch`).toBe(expected(role, "task:update"));

      const complete = await api.post(`/api/v1/tasks/${task.id}/complete`, { data: { note: "done" } });
      expect(complete.status(), `${role} complete`).toBe(expected(role, "task:update"));

      const other = await newTask();
      const skip = await api.post(`/api/v1/tasks/${other.id}/skip`, { data: {} });
      expect(skip.status(), `${role} skip`).toBe(expected(role, "task:update"));

      const del = await api.delete(`/api/v1/tasks/${task.id}`);
      expect(del.status(), `${role} delete`).toBe(expected(role, "task:delete"));
    }
  });

  test("lifecycle: complete sets status and time, can't complete twice, closed tasks limit edits", async () => {
    const owner = await apiAsRole("owner");
    const task = await newTask();
    const done = await (
      await owner.post(`/api/v1/tasks/${task.id}/complete`, { data: { note: "Spoke to them" } })
    ).json();
    expect(done.task.status).toBe("completed");
    expect(done.task.completedAt).toBeTruthy();
    expect(done.task.note).toContain("Spoke to them");
    expect((await owner.post(`/api/v1/tasks/${task.id}/complete`, { data: {} })).status()).toBe(422);
    expect((await owner.post(`/api/v1/tasks/${task.id}/skip`, { data: {} })).status()).toBe(422);
    expect((await owner.patch(`/api/v1/tasks/${task.id}`, { data: { title: "new" } })).status()).toBe(422);
    expect((await owner.patch(`/api/v1/tasks/${task.id}`, { data: { priority: "low" } })).status()).toBe(200);
    const reopened = await owner.patch(`/api/v1/tasks/${task.id}`, { data: { status: "open" } });
    expect((await reopened.json()).task.status).toBe("open");
    expect((await owner.patch(`/api/v1/tasks/${task.id}`, { data: {} })).status()).toBe(422);
    expect((await owner.get(`/api/v1/tasks/${crypto.randomUUID()}`)).status()).toBe(404);
  });

  test("Globex can't see or touch Acme tasks", async () => {
    const task = await newTask();
    const globex = await globexApi();
    expect((await globex.get(`/api/v1/tasks/${task.id}`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/tasks/${task.id}`, { data: { title: "x" } })).status()).toBe(404);
    expect((await globex.post(`/api/v1/tasks/${task.id}/complete`, { data: {} })).status()).toBe(404);
    expect((await globex.post(`/api/v1/tasks/${task.id}/skip`, { data: {} })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/tasks/${task.id}`)).status()).toBe(404);
    const list = await (await globex.post("/api/v1/tasks/search", { data: { per_page: 100 } })).json();
    expect(list.tasks.some((t: { id: string }) => t.id === task.id)).toBe(false);
    const acmeContact = await insertContact(await acmeOrgId());
    expect((await globex.post("/api/v1/tasks", { data: { title: "x", contactId: acmeContact } })).status()).toBe(422);

    const key = await apiWithKey((await globexKey()).secret);
    expect((await key.get(`/api/v1/tasks/${task.id}`)).status()).toBe(404);
    expect((await key.delete(`/api/v1/tasks/${task.id}`)).status()).toBe(404);
  });

  test("API keys: the key's role is enforced; revoked keys get 401", async () => {
    const viewer = await acmeKeyClient("viewer");
    expect((await viewer.post("/api/v1/tasks/search", { data: {} })).status()).toBe(200);
    expect((await viewer.post("/api/v1/tasks", { data: { title: "x" } })).status()).toBe(403);

    const member = await acmeKeyClient("member");
    // Keys act as the user who created them, so a task defaults to that user.
    const created = await member.post("/api/v1/tasks", { data: { title: uniq("via key") } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).task.id;
    expect((await member.post(`/api/v1/tasks/${id}/complete`, { data: {} })).status()).toBe(200);
    expect((await member.delete(`/api/v1/tasks/${id}`)).status()).toBe(200);

    const owner = await apiAsRole("owner");
    const temp = await createKey(owner, "member");
    const tempApi = await apiWithKey(temp.secret);
    expect((await tempApi.post("/api/v1/tasks/search", { data: {} })).status()).toBe(200);
    expect((await owner.delete(`/api/v1/api_keys/${temp.id}`)).status()).toBe(200);
    expect((await tempApi.post("/api/v1/tasks/search", { data: {} })).status()).toBe(401);
    expect((await acmeKey("viewer")).secret.startsWith("al_")).toBe(true);
  });

  test("cross-site cookie writes are refused", async () => {
    const owner = await apiAsRole("owner");
    const res = await owner.post(`${BASE_URL}/api/v1/tasks`, { headers: EVIL_ORIGIN, data: { title: "x" } });
    expect(res.status()).toBe(403);
    const task = await newTask();
    expect((await owner.post(`/api/v1/tasks/${task.id}/complete`, { headers: EVIL_ORIGIN, data: {} })).status()).toBe(
      403,
    );
    expect((await owner.delete(`/api/v1/tasks/${task.id}`, { headers: EVIL_ORIGIN })).status()).toBe(403);
  });

  test("writes are audited", async () => {
    const owner = await apiAsRole("owner");
    const task = await newTask();
    await owner.post(`/api/v1/tasks/${task.id}/skip`, { data: {} });
    const log = await (await owner.get(`/api/v1/audit_logs?entityId=${task.id}`)).json();
    const actions = log.audit_logs.map((l: { action: string }) => l.action);
    expect(actions).toContain("task.create");
    expect(actions).toContain("task.skip");
  });
});
