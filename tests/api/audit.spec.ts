import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAsRole, apiWithKey } from "../support/session";
import { acmeKey, acmeKeyClient, globexApi, globexKey, uniq, userIdOf } from "./admin-helpers";

interface Entry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  actor: { kind: string; id?: string; name?: string | null; email?: string | null; prefix?: string | null };
}

test.describe("audit log API", () => {
  test("every role per matrix; 401 signed out; paginated", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/audit_logs?per_page=5");
      expect(res.status(), role).toBe(expected(role, "audit:read"));
      if (res.ok()) {
        const body = await res.json();
        expect(body.audit_logs.length).toBeLessThanOrEqual(5);
        expect(body.pagination).toMatchObject({ page: 1, per_page: 5 });
      }
    }
    expect((await (await anonymous()).get("/api/v1/audit_logs")).status()).toBe(401);
  });

  test("filters by action prefix, actor, entity type, entity id and date range; joins the actor", async () => {
    const manager = await apiAsRole("manager");
    const owner = await apiAsRole("owner");
    const before = new Date(Date.now() - 1000).toISOString();
    const created = await manager.post("/api/v1/tasks", { data: { title: uniq("Audited") } });
    const taskId = (await created.json()).task.id;

    const byEntity = await (await owner.get(`/api/v1/audit_logs?entityId=${taskId}`)).json();
    const entry = byEntity.audit_logs[0] as Entry;
    expect(entry).toMatchObject({ action: "task.create", entityType: "task", entityId: taskId });
    expect(entry.actor).toMatchObject({ kind: "user", email: ACME.manager, name: "Acme Manager" });

    const managerId = await userIdOf(ACME.manager);
    const byActor = await (await owner.get(`/api/v1/audit_logs?actorId=${managerId}&per_page=100`)).json();
    expect(byActor.audit_logs.every((e: Entry) => e.actor.id === managerId)).toBe(true);

    const byPrefix = await (await owner.get("/api/v1/audit_logs?action=task.&per_page=100")).json();
    expect(byPrefix.audit_logs.every((e: Entry) => e.action.startsWith("task."))).toBe(true);

    const byType = await (await owner.get("/api/v1/audit_logs?entityType=task&per_page=100")).json();
    expect(byType.audit_logs.every((e: Entry) => e.entityType === "task")).toBe(true);

    const inRange = await (
      await owner.get(`/api/v1/audit_logs?entityId=${taskId}&from=${encodeURIComponent(before)}`)
    ).json();
    expect(inRange.audit_logs).toHaveLength(1);
    const outOfRange = await (
      await owner.get(`/api/v1/audit_logs?entityId=${taskId}&to=${encodeURIComponent(before)}`)
    ).json();
    expect(outOfRange.audit_logs).toHaveLength(0);

    expect((await owner.get("/api/v1/audit_logs?from=yesterday-ish")).status()).toBe(422);
  });

  test("API key actions are attributed to the key", async () => {
    const key = await acmeKeyClient("member");
    const created = await key.post("/api/v1/tasks", { data: { title: uniq("by key") } });
    const taskId = (await created.json()).task.id;
    const log = await (await (await apiAsRole("owner")).get(`/api/v1/audit_logs?entityId=${taskId}`)).json();
    expect(log.audit_logs[0].actor).toMatchObject({ kind: "apiKey", id: (await acmeKey("member")).id });
    expect(log.audit_logs[0].actor.prefix).toMatch(/^al_/);
    const manager = await acmeKeyClient("manager");
    expect((await manager.get("/api/v1/audit_logs")).status()).toBe(200);
    const viewer = await acmeKeyClient("viewer");
    expect((await viewer.get("/api/v1/audit_logs")).status()).toBe(403);
  });

  test("Globex never sees Acme's log", async () => {
    const owner = await apiAsRole("owner");
    const created = await owner.post("/api/v1/tasks", { data: { title: uniq("Secret") } });
    const taskId = (await created.json()).task.id;
    const globex = await globexApi();
    const log = await (await globex.get(`/api/v1/audit_logs?entityId=${taskId}`)).json();
    expect(log.audit_logs).toHaveLength(0);
    const all = await (await globex.get("/api/v1/audit_logs?per_page=100")).json();
    expect(all.audit_logs.some((e: Entry) => e.actor.email?.endsWith("@acme.test"))).toBe(false);
    const key = await apiWithKey((await globexKey()).secret);
    expect((await (await key.get(`/api/v1/audit_logs?entityId=${taskId}`)).json()).audit_logs).toHaveLength(0);
  });
});
