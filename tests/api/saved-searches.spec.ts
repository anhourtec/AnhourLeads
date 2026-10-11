import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { pg, uniq } from "./_engage";
import { randomUUID } from "node:crypto";

test.describe.configure({ timeout: 120_000 });

interface Saved {
  id: string;
  name: string;
  entityType: string;
  filters: Record<string, unknown>;
  columns: string[] | null;
  starred: boolean;
  shared: boolean;
  alertsEnabled: boolean;
  isOwner: boolean;
  assignedToId: string | null;
}

async function create(api: APIRequestContext, data: Record<string, unknown> = {}): Promise<Saved> {
  const res = await api.post("/api/v1/saved_searches", {
    data: { name: uniq("search"), entityType: "contact", filters: { titles: ["founder"] }, ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).saved_search;
}

async function list(api: APIRequestContext, query = ""): Promise<Saved[]> {
  const res = await api.get(`/api/v1/saved_searches${query}`);
  expect(res.status()).toBe(200);
  return (await res.json()).saved_searches;
}

async function userId(email: string): Promise<string> {
  const { rows } = await pg().query<{ id: string }>('select id from "user" where email = $1', [email]);
  return rows[0].id;
}

test.describe("saved searches: role matrix", () => {
  test("GET and POST for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      expect((await api.get("/api/v1/saved_searches")).status(), role).toBe(expected(role, "search:run"));
      const res = await api.post("/api/v1/saved_searches", {
        data: { name: uniq(`s-${role}`), entityType: "company", filters: { industry: ["Software"] } },
      });
      expect(res.status(), role).toBe(expected(role, "savedsearch:create", 201));
    }
  });

  test("GET, PATCH, DELETE /saved_searches/[id] on one's own search, for every role that can save", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      // Viewers can't save, so they act on a shared search instead.
      const owned = role === "viewer" ? await create(await apiAsRole("owner"), { shared: true }) : await create(api);
      expect((await api.get(`/api/v1/saved_searches/${owned.id}`)).status(), role).toBe(200);
      const patch = await api.patch(`/api/v1/saved_searches/${owned.id}`, { data: { name: uniq("renamed") } });
      expect(patch.status(), role).toBe(expected(role, "savedsearch:create"));
      const del = await api.delete(`/api/v1/saved_searches/${owned.id}`);
      expect(del.status(), role).toBe(expected(role, "savedsearch:create"));
    }
  });

  test("anonymous requests get 401", async () => {
    const api = await anonymous();
    expect((await api.get("/api/v1/saved_searches")).status()).toBe(401);
    expect((await api.post("/api/v1/saved_searches", { data: { name: "x", entityType: "contact" } })).status()).toBe(
      401,
    );
    expect((await api.patch(`/api/v1/saved_searches/${randomUUID()}`, { data: { name: "x" } })).status()).toBe(401);
    expect((await api.delete(`/api/v1/saved_searches/${randomUUID()}`)).status()).toBe(401);
  });

  test("cookie writes from another site are refused", async () => {
    const api = await apiAsRole("member");
    const evil = { origin: "https://evil.example" };
    const mine = await create(api);
    expect(
      (
        await api.post("/api/v1/saved_searches", { data: { name: "x", entityType: "contact" }, headers: evil })
      ).status(),
    ).toBe(403);
    expect(
      (await api.patch(`/api/v1/saved_searches/${mine.id}`, { data: { name: "x" }, headers: evil })).status(),
    ).toBe(403);
    expect((await api.delete(`/api/v1/saved_searches/${mine.id}`, { headers: evil })).status()).toBe(403);
  });
});

test.describe("saved searches: behaviour", () => {
  test("visibility: own, shared and assigned; private ones stay private", async () => {
    const member = await apiAsRole("member");
    const manager = await apiAsRole("manager");
    const managerId = await userId(ACME.manager);
    const priv = await create(member, { name: uniq("private") });
    const shared = await create(member, { name: uniq("shared"), shared: true });
    const assigned = await create(member, { name: uniq("assigned"), assignedToId: managerId });

    const seen = (await list(manager)).map((s) => s.id);
    expect(seen).toContain(shared.id);
    expect(seen).toContain(assigned.id);
    expect(seen).not.toContain(priv.id);
    expect((await manager.get(`/api/v1/saved_searches/${priv.id}`)).status()).toBe(404);
    expect((await list(manager, "?tab=assigned")).map((s) => s.id)).toContain(assigned.id);
    expect((await list(manager, "?tab=shared")).map((s) => s.id)).toContain(shared.id);
    expect((await list(manager, "?tab=mine")).map((s) => s.id)).not.toContain(shared.id);
    expect((await list(member, "?tab=mine")).map((s) => s.id)).toEqual(
      expect.arrayContaining([priv.id, shared.id, assigned.id]),
    );
    expect((await list(member, "?entityType=company")).map((s) => s.id)).not.toContain(priv.id);
  });

  test("only the owner edits or deletes; anyone who sees it may star it", async () => {
    const member = await apiAsRole("member");
    const manager = await apiAsRole("manager");
    const shared = await create(member, { shared: true });
    expect((await manager.patch(`/api/v1/saved_searches/${shared.id}`, { data: { name: "taken" } })).status()).toBe(
      403,
    );
    expect((await manager.delete(`/api/v1/saved_searches/${shared.id}`)).status()).toBe(403);
    const star = await manager.patch(`/api/v1/saved_searches/${shared.id}`, { data: { starred: true } });
    expect(star.status()).toBe(200);
    expect((await star.json()).saved_search.starred).toBe(true);
    expect((await list(member, "?tab=starred")).map((s) => s.id)).toContain(shared.id);

    const updated = await member.patch(`/api/v1/saved_searches/${shared.id}`, {
      data: {
        name: "Renamed",
        filters: { titles: ["vp sales"], seniority: ["vp"], "cf.tier": "Gold" },
        columns: ["title", "company", "emails"],
        sort: { field: "name", ascending: true },
        alertsEnabled: true,
      },
    });
    expect(updated.status(), await updated.text()).toBe(200);
    const body = (await updated.json()).saved_search as Saved & { sort: unknown };
    expect(body.name).toBe("Renamed");
    expect(body.filters).toEqual({ titles: ["vp sales"], seniority: ["vp"], cf: { tier: "Gold" } });
    expect(body.columns).toEqual(["title", "company", "emails"]);
    expect(body.sort).toEqual({ field: "name", ascending: true });
    expect(body.alertsEnabled).toBe(true);
    expect((await member.delete(`/api/v1/saved_searches/${shared.id}`)).status()).toBe(200);
    expect((await member.get(`/api/v1/saved_searches/${shared.id}`)).status()).toBe(404);
  });

  test("validation errors are 422", async () => {
    const api = await apiAsRole("member");
    const globexUser = await userId(GLOBEX_OWNER);
    const bad: Record<string, unknown>[] = [
      { entityType: "contact" },
      { name: "", entityType: "contact" },
      { name: "x", entityType: "deal" },
      { name: "x", entityType: "contact", filters: { emailStatus: ["nope"] } },
      { name: "x", entityType: "company", filters: { stage: ["new"] } },
      { name: "x", entityType: "contact", assignedToId: globexUser },
      { name: "x", entityType: "contact", sort: { field: "name" } },
      { name: "x", entityType: "contact", unknown: true },
    ];
    for (const data of bad) {
      const res = await api.post("/api/v1/saved_searches", { data });
      expect(res.status(), JSON.stringify(data)).toBe(422);
    }
    const mine = await create(api);
    expect((await api.patch(`/api/v1/saved_searches/${mine.id}`, { data: {} })).status()).toBe(422);
  });

  test("workspace isolation", async () => {
    const owner = await apiAsRole("owner");
    const globex = await apiAs(GLOBEX_OWNER);
    const acme = await create(owner, { shared: true });
    expect((await globex.get(`/api/v1/saved_searches/${acme.id}`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/saved_searches/${acme.id}`, { data: { starred: true } })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/saved_searches/${acme.id}`)).status()).toBe(404);
    expect((await list(globex)).map((s) => s.id)).not.toContain(acme.id);

    // Filters can't point at another workspace's lists.
    const acmeList = await owner.post("/api/v1/labels", { data: { name: uniq("iso"), entityType: "contact" } });
    const listId = (await acmeList.json()).label.id as string;
    const res = await globex.post("/api/v1/saved_searches", {
      data: { name: "steal", entityType: "contact", filters: { listId: [listId] } },
    });
    expect(res.status()).toBe(404);
  });
});
