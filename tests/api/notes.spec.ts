import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { createCompany, createContact, uniq } from "./_engage";

const EVIL = { origin: "https://evil.example" };

async function addNote(api: APIRequestContext, entityId: string, body = uniq("note"), entityType = "contact") {
  const res = await api.post("/api/v1/notes", { data: { entityType, entityId, body } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).note as { id: string; body: string; author: { id: string } | null };
}

const owner = () => apiAsRole("owner");

test.describe("notes: role matrix", () => {
  test("GET /notes for every role", async () => {
    const contactId = await createContact("acme");
    await addNote(await owner(), contactId);
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get(`/api/v1/notes?entityType=contact&entityId=${contactId}`);
      expect(res.status(), role).toBe(expected(role, "contact:read"));
      if (res.ok()) expect((await res.json()).notes.length).toBeGreaterThanOrEqual(1);
    }
  });

  test("POST /notes for every role", async () => {
    const contactId = await createContact("acme");
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).post("/api/v1/notes", {
        data: { entityType: "contact", entityId: contactId, body: `by ${role}` },
      });
      expect(res.status(), role).toBe(expected(role, "note:create", 201));
    }
  });

  test("DELETE /notes/[id] of your own note for every role", async () => {
    const contactId = await createContact("acme");
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      // Viewers can't write notes, so give them one written by the owner: still 403.
      const note = role === "viewer" ? await addNote(await owner(), contactId) : await addNote(api, contactId);
      const res = await api.delete(`/api/v1/notes/${note.id}`);
      expect(res.status(), role).toBe(expected(role, "note:create"));
    }
  });

  test("activities endpoints for every role", async () => {
    const companyId = await createCompany("acme");
    const contactId = await createContact("acme", { companyId });
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const c = await api.get(`/api/v1/contacts/${contactId}/activities`);
      expect(c.status(), role).toBe(expected(role, "contact:read"));
      const a = await api.get(`/api/v1/accounts/${companyId}/activities`);
      expect(a.status(), role).toBe(expected(role, "company:read"));
      if (a.ok()) {
        const body = await a.json();
        expect(Array.isArray(body.activities)).toBe(true);
        expect(body.pagination.page).toBe(1);
      }
    }
  });
});

test.describe("notes: delete rules", () => {
  test("own note vs someone else's note", async () => {
    const contactId = await createContact("acme");
    const member = await apiAsRole("member");
    const mine = await addNote(member, contactId);
    expect((await member.delete(`/api/v1/notes/${mine.id}`)).status()).toBe(200);

    const others = await addNote(await owner(), contactId);
    const refused = await member.delete(`/api/v1/notes/${others.id}`);
    expect(refused.status()).toBe(403);
    const manager = await apiAsRole("manager");
    expect((await manager.delete(`/api/v1/notes/${others.id}`)).status()).toBe(200);
    expect((await manager.delete(`/api/v1/notes/${others.id}`)).status()).toBe(404);
  });

  test("notes on companies and deals resolve their record", async () => {
    const api = await owner();
    const companyId = await createCompany("acme");
    const note = await addNote(api, companyId, "company note", "company");
    const list = await (await api.get(`/api/v1/notes?entityType=company&entityId=${companyId}`)).json();
    expect(list.notes.map((n: { id: string }) => n.id)).toContain(note.id);
    const missingDeal = await api.post("/api/v1/notes", {
      data: { entityType: "deal", entityId: "no-such-deal", body: "x" },
    });
    expect(missingDeal.status()).toBe(404);
  });
});

test.describe("notes and activities: guards", () => {
  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    expect((await api.get("/api/v1/notes?entityType=contact&entityId=x")).status()).toBe(401);
    expect(
      (await api.post("/api/v1/notes", { data: { entityType: "contact", entityId: "x", body: "y" } })).status(),
    ).toBe(401);
    expect((await api.delete("/api/v1/notes/x")).status()).toBe(401);
    expect((await api.get("/api/v1/contacts/x/activities")).status()).toBe(401);
    expect((await api.get("/api/v1/accounts/x/activities")).status()).toBe(401);
  });

  test("validation errors are 422", async () => {
    const api = await owner();
    const contactId = await createContact("acme");
    expect(
      (await api.post("/api/v1/notes", { data: { entityType: "contact", entityId: contactId, body: "  " } })).status(),
    ).toBe(422);
    expect(
      (await api.post("/api/v1/notes", { data: { entityType: "planet", entityId: contactId, body: "x" } })).status(),
    ).toBe(422);
    expect((await api.post("/api/v1/notes", { data: { entityType: "contact", body: "x" } })).status()).toBe(422);
    expect(
      (
        await api.post("/api/v1/notes", {
          data: { entityType: "contact", entityId: contactId, body: "x".repeat(10_001) },
        })
      ).status(),
    ).toBe(422);
    expect((await api.get("/api/v1/notes?entityType=contact")).status()).toBe(422);
  });

  test("cross-site cookie writes are refused", async () => {
    const api = await owner();
    const contactId = await createContact("acme");
    const note = await addNote(api, contactId);
    const post = await api.post("/api/v1/notes", {
      headers: EVIL,
      data: { entityType: "contact", entityId: contactId, body: "x" },
    });
    expect(post.status()).toBe(403);
    expect((await api.delete(`/api/v1/notes/${note.id}`, { headers: EVIL })).status()).toBe(403);
  });

  test("another workspace can't see or touch Acme's notes and timelines", async () => {
    const acme = await owner();
    const companyId = await createCompany("acme");
    const contactId = await createContact("acme", { companyId });
    const note = await addNote(acme, contactId, uniq("secret"));
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/notes?entityType=contact&entityId=${contactId}`)).status()).toBe(404);
    expect(
      (
        await globex.post("/api/v1/notes", { data: { entityType: "contact", entityId: contactId, body: "x" } })
      ).status(),
    ).toBe(404);
    expect((await globex.delete(`/api/v1/notes/${note.id}`)).status()).toBe(404);
    expect((await globex.get(`/api/v1/contacts/${contactId}/activities`)).status()).toBe(404);
    expect((await globex.get(`/api/v1/accounts/${companyId}/activities`)).status()).toBe(404);
    // A Globex record's notes never include Acme's.
    const globexContact = await createContact("globex");
    const own = await (await globex.get(`/api/v1/notes?entityType=contact&entityId=${globexContact}`)).json();
    expect(own.notes).toEqual([]);
    // The Acme note is still there.
    const still = await (await acme.get(`/api/v1/notes?entityType=contact&entityId=${contactId}`)).json();
    expect(still.notes.map((n: { id: string }) => n.id)).toContain(note.id);
  });
});

test.describe("activity timeline", () => {
  test("create, stage change and note each add a row", async () => {
    const api = await owner();
    const companyId = await createCompany("acme");
    const email = `${uniq("tl")}@timeline.example`;
    const created = await api.post("/api/v1/contacts", {
      data: { firstName: "Timeline", lastName: "Person", email, companyId },
    });
    expect(created.status(), await created.text()).toBe(201);
    const contactId = (await created.json()).contact.id as string;

    const patched = await api.patch(`/api/v1/contacts/${contactId}`, { data: { stage: "interested" } });
    expect(patched.status()).toBe(200);
    await addNote(api, contactId, "Called, keen on a demo");

    const res = await api.get(`/api/v1/contacts/${contactId}/activities`);
    expect(res.status()).toBe(200);
    const types = (await res.json()).activities.map((a: { type: string }) => a.type);
    expect(types).toEqual(expect.arrayContaining(["contact_created", "stage_changed", "note_added"]));
    expect(types[0]).toBe("note_added");

    const filtered = await (await api.get(`/api/v1/contacts/${contactId}/activities?type=note_added`)).json();
    expect(filtered.activities.every((a: { type: string }) => a.type === "note_added")).toBe(true);
    expect(filtered.activities.length).toBe(1);

    const account = await (await api.get(`/api/v1/accounts/${companyId}/activities`)).json();
    expect(account.activities.map((a: { type: string }) => a.type)).toEqual(
      expect.arrayContaining(["contact_created", "note_added"]),
    );

    const page = await (await api.get(`/api/v1/contacts/${contactId}/activities?per_page=1&page=2`)).json();
    expect(page.activities.length).toBe(1);
    expect(page.pagination.total_entries).toBeGreaterThanOrEqual(3);
  });
});
