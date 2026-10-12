import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { createContact, pg, uniq } from "./_engage";

interface PersonaBody {
  id: string;
  name: string;
  titles: string[];
  seniorities: string[];
  departments: string[];
}

const owner = () => apiAsRole("owner");

async function createPersona(api: APIRequestContext, data: Record<string, unknown> = {}): Promise<PersonaBody> {
  const res = await api.post("/api/v1/personas", {
    data: { name: uniq("Persona"), titles: ["VP sales"], seniorities: ["vp"], departments: ["Sales"], ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).persona;
}

test.describe("personas: role matrix", () => {
  test("GET /personas for every role", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/personas");
      expect(res.status(), role).toBe(expected(role, "contact:read"));
      if (res.ok()) expect(Array.isArray((await res.json()).personas)).toBe(true);
    }
  });

  test("POST /personas for every role", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).post("/api/v1/personas", {
        data: { name: uniq(`P ${role}`), titles: ["Founder"] },
      });
      expect(res.status(), role).toBe(expected(role, "persona:manage", 201));
    }
  });

  test("GET, PATCH, DELETE /personas/[id] for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const p = await createPersona(await owner());
      expect((await api.get(`/api/v1/personas/${p.id}`)).status(), role).toBe(expected(role, "contact:read"));
      const patch = await api.patch(`/api/v1/personas/${p.id}`, { data: { name: uniq("Renamed") } });
      expect(patch.status(), role).toBe(expected(role, "persona:manage"));
      expect((await api.delete(`/api/v1/personas/${p.id}`)).status(), role).toBe(expected(role, "persona:manage"));
    }
  });

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    expect((await api.get("/api/v1/personas")).status()).toBe(401);
    expect((await api.post("/api/v1/personas", { data: { name: "x", titles: ["y"] } })).status()).toBe(401);
    expect((await api.get("/api/v1/personas/some-id")).status()).toBe(401);
    expect((await api.patch("/api/v1/personas/some-id", { data: { name: "x" } })).status()).toBe(401);
    expect((await api.delete("/api/v1/personas/some-id")).status()).toBe(401);
  });

  test("cross-site cookie writes are refused (CSRF)", async () => {
    const res = await (await owner()).post("/api/v1/personas", {
      data: { name: uniq("Csrf"), titles: ["x"] },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("personas: isolation and validation", () => {
  test("Globex can't see or change Acme's personas", async () => {
    const p = await createPersona(await owner());
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/personas/${p.id}`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/personas/${p.id}`, { data: { name: "Hijack" } })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/personas/${p.id}`)).status()).toBe(404);
    const list = (await (await globex.get("/api/v1/personas")).json()).personas as PersonaBody[];
    expect(list.some((x) => x.id === p.id)).toBe(false);
  });

  test("bad input is a 422", async () => {
    const api = await owner();
    const post = (data: Record<string, unknown>) => api.post("/api/v1/personas", { data });
    expect((await post({ name: uniq("Empty") })).status()).toBe(422);
    expect((await post({ name: uniq("Empty"), titles: [], seniorities: [], departments: [] })).status()).toBe(422);
    expect((await post({ name: "", titles: ["x"] })).status()).toBe(422);
    expect((await post({ name: uniq("Bad"), seniorities: ["emperor"] })).status()).toBe(422);
    expect((await post({ name: uniq("Bad"), titles: Array.from({ length: 51 }, (_, i) => `t${i}`) })).status()).toBe(
      422,
    );
    const p = await createPersona(api);
    expect((await post({ name: p.name.toUpperCase(), titles: ["x"] })).status()).toBe(422);
    const clear = await api.patch(`/api/v1/personas/${p.id}`, {
      data: { titles: [], seniorities: [], departments: [] },
    });
    expect(clear.status()).toBe(422);
  });

  test("titles are de-duplicated and edits are returned", async () => {
    const api = await owner();
    const p = await createPersona(api, { titles: ["CTO", "cto", "VP engineering"], seniorities: ["c_suite", "vp"] });
    expect(p.titles).toEqual(["CTO", "VP engineering"]);
    const res = await api.patch(`/api/v1/personas/${p.id}`, { data: { departments: ["Engineering & Technical"] } });
    expect(res.status()).toBe(200);
    expect((await res.json()).persona.departments).toEqual(["Engineering & Technical"]);
  });

  test("deleting a persona untags people", async () => {
    const api = await owner();
    const p = await createPersona(api);
    const contactId = await createContact("acme");
    const patch = await api.patch(`/api/v1/contacts/${contactId}`, { data: { personaId: p.id } });
    expect(patch.status(), await patch.text()).toBe(200);
    expect((await patch.json()).contact.personaId).toBe(p.id);
    expect((await api.delete(`/api/v1/personas/${p.id}`)).status()).toBe(200);
    const { rows } = await pg().query<{ persona_id: string | null }>("select persona_id from contact where id = $1", [
      contactId,
    ]);
    expect(rows[0].persona_id).toBeNull();
    // A Globex persona id can't be set on an Acme contact.
    const g = await createPersona(await apiAs(GLOBEX_OWNER));
    expect((await api.patch(`/api/v1/contacts/${contactId}`, { data: { personaId: g.id } })).status()).toBe(404);
  });
});
