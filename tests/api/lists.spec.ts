import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";
import { createCompany, createContact, uniq } from "./_engage";

interface ListBody {
  id: string;
  name: string;
  entityType: string;
  kind: string;
  memberCount: number;
}

async function createList(api: APIRequestContext, data: Record<string, unknown> = {}): Promise<ListBody> {
  const res = await api.post("/api/v1/labels", { data: { name: uniq("list"), entityType: "contact", ...data } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).label;
}

const owner = () => apiAsRole("owner");

test.describe("lists (labels): role matrix", () => {
  test("GET /labels for every role", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/labels");
      expect(res.status(), role).toBe(expected(role, "list:read"));
      if (res.ok()) expect(Array.isArray((await res.json()).labels)).toBe(true);
    }
  });

  test("POST /labels for every role", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).post("/api/v1/labels", {
        data: { name: uniq(`list-${role}`), entityType: "contact" },
      });
      expect(res.status(), role).toBe(expected(role, "list:create", 201));
    }
  });

  test("GET, PATCH, DELETE /labels/[id] for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const list = await createList(await owner());
      expect((await api.get(`/api/v1/labels/${list.id}`)).status(), role).toBe(expected(role, "list:read"));
      const patch = await api.patch(`/api/v1/labels/${list.id}`, { data: { name: uniq("renamed") } });
      expect(patch.status(), role).toBe(expected(role, "list:update"));
      const del = await api.delete(`/api/v1/labels/${list.id}`);
      expect(del.status(), role).toBe(expected(role, "list:delete"));
    }
  });

  test("members, add and remove for every role", async () => {
    const contactId = await createContact("acme");
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const list = await createList(await owner());
      const add = await api.post("/api/v1/labels/add_entity_ids", {
        data: { listId: list.id, entityIds: [contactId] },
      });
      expect(add.status(), role).toBe(expected(role, "list:update"));
      const members = await api.get(`/api/v1/labels/${list.id}/members`);
      expect(members.status(), role).toBe(expected(role, "list:read"));
      const candidates = await api.get(`/api/v1/labels/${list.id}/candidates?q=Test`);
      expect(candidates.status(), role).toBe(expected(role, "list:update"));
      const remove = await api.post("/api/v1/labels/remove_entity_ids", {
        data: { listId: list.id, entityIds: [contactId] },
      });
      expect(remove.status(), role).toBe(expected(role, "list:update"));
    }
  });

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    expect((await api.get("/api/v1/labels")).status()).toBe(401);
    expect((await api.post("/api/v1/labels", { data: { name: "x", entityType: "contact" } })).status()).toBe(401);
    expect((await api.get("/api/v1/labels/some-id/members")).status()).toBe(401);
    expect((await api.post("/api/v1/labels/add_entity_ids", { data: {} })).status()).toBe(401);
  });

  test("cross-site cookie writes are refused", async () => {
    const api = await owner();
    const res = await api.post(`${BASE_URL}/api/v1/labels`, {
      headers: { origin: "https://evil.example" },
      data: { name: uniq("csrf"), entityType: "contact" },
    });
    expect(res.status()).toBe(403);
    const list = await createList(api);
    const del = await api.delete(`/api/v1/labels/${list.id}`, { headers: { origin: "https://evil.example" } });
    expect(del.status()).toBe(403);
  });
});

test.describe("lists (labels): behaviour", () => {
  test("static contact list: add, page, remove, counts", async () => {
    const api = await owner();
    const list = await createList(api);
    const ids = [await createContact("acme"), await createContact("acme"), await createContact("acme")];
    const add = await api.post("/api/v1/labels/add_entity_ids", { data: { listId: list.id, entityIds: ids } });
    expect(add.status()).toBe(200);
    expect((await add.json()).added).toBe(3);

    const again = await api.post("/api/v1/labels/add_entity_ids", { data: { listId: list.id, entityIds: ids } });
    expect((await again.json()).alreadyMembers).toBe(3);

    const page1 = await (await api.get(`/api/v1/labels/${list.id}/members?per_page=2`)).json();
    expect(page1.entityType).toBe("contact");
    expect(page1.contacts).toHaveLength(2);
    expect(page1.pagination).toMatchObject({ page: 1, per_page: 2, total_entries: 3, total_pages: 2 });
    const page2 = await (await api.get(`/api/v1/labels/${list.id}/members?per_page=2&page=2`)).json();
    expect(page2.contacts).toHaveLength(1);

    const detail = await (await api.get(`/api/v1/labels/${list.id}`)).json();
    expect(detail.label.memberCount).toBe(3);

    const removed = await api.post("/api/v1/labels/remove_entity_ids", {
      data: { listId: list.id, entityIds: [ids[0]] },
    });
    expect((await removed.json()).removed).toBe(1);
    const after = await (await api.get(`/api/v1/labels/${list.id}/members`)).json();
    expect(after.pagination.total_entries).toBe(2);
  });

  test("company list resolves to accounts", async () => {
    const api = await owner();
    const list = await createList(api, { entityType: "company" });
    const companyId = await createCompany("acme");
    expect(
      (await api.post("/api/v1/labels/add_entity_ids", { data: { listId: list.id, entityIds: [companyId] } })).status(),
    ).toBe(200);
    const body = await (await api.get(`/api/v1/labels/${list.id}/members`)).json();
    expect(body.entityType).toBe("company");
    expect(body.accounts.map((a: { id: string }) => a.id)).toEqual([companyId]);
  });

  test("dynamic lists resolve members from filters", async () => {
    const api = await owner();
    const marker = uniq("Dyn");
    const match = await createContact("acme", { lastName: marker, country: "Canada", stage: "new" });
    await createContact("acme", { lastName: marker, country: "Canada", stage: "interested" });
    await createContact("acme", { lastName: marker, country: "France", stage: "new" });
    const list = await createList(api, { kind: "dynamic", filters: { q: marker, country: "canada", stage: "new" } });
    expect(list.memberCount).toBe(1);
    const body = await (await api.get(`/api/v1/labels/${list.id}/members`)).json();
    expect(body.contacts.map((c: { id: string }) => c.id)).toEqual([match]);

    const companyMarker = uniq("DynCo");
    const big = await createCompany("acme", { name: `${companyMarker} big`, industry: "Software", employeeCount: 500 });
    await createCompany("acme", { name: `${companyMarker} small`, industry: "Software", employeeCount: 5 });
    const companies = await createList(api, {
      entityType: "company",
      kind: "dynamic",
      filters: { q: companyMarker, industry: "software", employeeMin: 100 },
    });
    const companyBody = await (await api.get(`/api/v1/labels/${companies.id}/members`)).json();
    expect(companyBody.accounts.map((c: { id: string }) => c.id)).toEqual([big]);

    const add = await api.post("/api/v1/labels/add_entity_ids", { data: { listId: list.id, entityIds: [match] } });
    expect(add.status()).toBe(422);

    const patched = await api.patch(`/api/v1/labels/${list.id}`, { data: { filters: { q: marker } } });
    expect(patched.status()).toBe(200);
    expect((await patched.json()).label.memberCount).toBe(3);
  });

  test("validation errors are 422", async () => {
    const api = await owner();
    expect((await api.post("/api/v1/labels", { data: { entityType: "contact" } })).status()).toBe(422);
    expect((await api.post("/api/v1/labels", { data: { name: "x", entityType: "deal" } })).status()).toBe(422);
    expect(
      (
        await api.post("/api/v1/labels", {
          data: { name: uniq("d"), entityType: "contact", kind: "dynamic", filters: { stage: "nope" } },
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await api.post("/api/v1/labels", { data: { name: uniq("s"), entityType: "contact", filters: { q: "x" } } })
      ).status(),
    ).toBe(422);
    const list = await createList(api);
    const dup = await api.post("/api/v1/labels", { data: { name: list.name.toUpperCase(), entityType: "contact" } });
    expect(dup.status()).toBe(422);
    expect((await api.patch(`/api/v1/labels/${list.id}`, { data: { name: "" } })).status()).toBe(422);
    expect((await api.patch(`/api/v1/labels/${list.id}`, { data: { entityType: "company" } })).status()).toBe(422);
    expect(
      (await api.post("/api/v1/labels/add_entity_ids", { data: { listId: list.id, entityIds: [] } })).status(),
    ).toBe(422);
  });

  test("entity ids must exist in scope and match the list's type", async () => {
    const api = await owner();
    const list = await createList(api);
    const company = await createCompany("acme");
    const wrongType = await api.post("/api/v1/labels/add_entity_ids", {
      data: { listId: list.id, entityIds: [company] },
    });
    expect(wrongType.status()).toBe(404);
    const globexContact = await createContact("globex");
    const foreign = await api.post("/api/v1/labels/add_entity_ids", {
      data: { listId: list.id, entityIds: [globexContact] },
    });
    expect(foreign.status()).toBe(404);
    const missingList = await api.post("/api/v1/labels/add_entity_ids", {
      data: { listId: "does-not-exist", entityIds: [globexContact] },
    });
    expect(missingList.status()).toBe(404);
  });
});

test.describe("lists (labels): workspace isolation", () => {
  test("Globex can't read or change Acme lists, and never sees them", async () => {
    const acme = await owner();
    const list = await createList(acme);
    const contact = await createContact("acme");
    await acme.post("/api/v1/labels/add_entity_ids", { data: { listId: list.id, entityIds: [contact] } });

    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/labels/${list.id}`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/labels/${list.id}`, { data: { name: "taken" } })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/labels/${list.id}`)).status()).toBe(404);
    expect((await globex.get(`/api/v1/labels/${list.id}/members`)).status()).toBe(404);
    expect((await globex.get(`/api/v1/labels/${list.id}/candidates`)).status()).toBe(404);
    expect(
      (
        await globex.post("/api/v1/labels/add_entity_ids", { data: { listId: list.id, entityIds: [contact] } })
      ).status(),
    ).toBe(404);
    expect(
      (
        await globex.post("/api/v1/labels/remove_entity_ids", { data: { listId: list.id, entityIds: [contact] } })
      ).status(),
    ).toBe(404);

    const all = await (await globex.get("/api/v1/labels")).json();
    expect(all.labels.some((l: { id: string }) => l.id === list.id)).toBe(false);

    // Globex's own list can't take Acme's contacts.
    const own = await createList(globex);
    const steal = await globex.post("/api/v1/labels/add_entity_ids", {
      data: { listId: own.id, entityIds: [contact] },
    });
    expect(steal.status()).toBe(404);

    // Acme is unaffected.
    expect((await acme.get(`/api/v1/labels/${list.id}`)).status()).toBe(200);
  });
});
