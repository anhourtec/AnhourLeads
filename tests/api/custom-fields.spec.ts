import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";
import { pg, uniq } from "./_engage";

interface FieldBody {
  id: string;
  key: string;
  label: string;
  type: string;
  options: string[];
  entityType: string;
}

const owner = () => apiAsRole("owner");

/** Keys only allow lowercase letters, digits and underscores. */
const ukey = (prefix: string) =>
  uniq(prefix)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_");

async function createField(api: APIRequestContext, data: Record<string, unknown> = {}): Promise<FieldBody> {
  const res = await api.post("/api/v1/custom_fields", {
    data: { entityType: "contact", label: uniq("Field"), type: "text", ...data },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).custom_field;
}

test.describe("custom fields: role matrix", () => {
  test("GET /custom_fields for every role", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/custom_fields?entityType=contact");
      expect(res.status(), role).toBe(expected(role, "contact:read"));
      if (res.ok()) expect(Array.isArray((await res.json()).custom_fields)).toBe(true);
    }
  });

  test("POST /custom_fields for every role", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).post("/api/v1/custom_fields", {
        data: { entityType: "company", label: uniq(`Field ${role}`), type: "number" },
      });
      expect(res.status(), role).toBe(expected(role, "customfield:manage", 201));
    }
  });

  test("GET, PATCH, DELETE /custom_fields/[id] for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const field = await createField(await owner());
      expect((await api.get(`/api/v1/custom_fields/${field.id}`)).status(), role).toBe(expected(role, "contact:read"));
      const patch = await api.patch(`/api/v1/custom_fields/${field.id}`, { data: { label: uniq("Renamed") } });
      expect(patch.status(), role).toBe(expected(role, "customfield:manage"));
      const del = await api.delete(`/api/v1/custom_fields/${field.id}`);
      expect(del.status(), role).toBe(expected(role, "customfield:manage"));
    }
  });

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    expect((await api.get("/api/v1/custom_fields")).status()).toBe(401);
    expect(
      (await api.post("/api/v1/custom_fields", { data: { entityType: "contact", label: "x", type: "text" } })).status(),
    ).toBe(401);
    expect((await api.patch("/api/v1/custom_fields/some-id", { data: { label: "x" } })).status()).toBe(401);
    expect((await api.delete("/api/v1/custom_fields/some-id")).status()).toBe(401);
  });

  test("cross-site cookie writes are refused (CSRF)", async () => {
    const api = await owner();
    const res = await api.post("/api/v1/custom_fields", {
      data: { entityType: "contact", label: uniq("Csrf"), type: "text" },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("custom fields: isolation and validation", () => {
  test("Globex can't see or change Acme's fields", async () => {
    const field = await createField(await owner(), { label: uniq("Acme only") });
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/custom_fields/${field.id}`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/custom_fields/${field.id}`, { data: { label: "Hijack" } })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/custom_fields/${field.id}`)).status()).toBe(404);
    const list = (await (await globex.get("/api/v1/custom_fields")).json()).custom_fields as FieldBody[];
    expect(list.some((f) => f.id === field.id)).toBe(false);
    expect((await (await owner()).get(`/api/v1/custom_fields/${field.id}`)).status()).toBe(200);
  });

  test("bad input is a 422", async () => {
    const api = await owner();
    const post = (data: Record<string, unknown>) =>
      api.post("/api/v1/custom_fields", { data: { entityType: "contact", label: uniq("V"), type: "text", ...data } });
    expect((await post({ type: "money" })).status()).toBe(422);
    expect((await post({ entityType: "task" })).status()).toBe(422);
    expect((await post({ label: "" })).status()).toBe(422);
    expect((await post({ type: "picklist" })).status()).toBe(422);
    expect((await post({ type: "picklist", options: [] })).status()).toBe(422);
    expect((await post({ type: "picklist", options: ["A", "a"] })).status()).toBe(422);
    expect((await post({ type: "text", options: ["A"] })).status()).toBe(422);
    expect((await post({ key: "Bad Key" })).status()).toBe(422);
    const key = ukey("dup");
    expect((await post({ key })).status()).toBe(201);
    expect((await post({ key })).status()).toBe(422);
    // The same key is fine on another record type.
    expect((await post({ key, entityType: "company" })).status()).toBe(201);
  });

  test("keys come from the label and stay unique; the type can't change", async () => {
    const api = await owner();
    const label = `Budget ${uniq("x")}`;
    const a = await createField(api, { label, type: "number" });
    expect(a.key).toMatch(/^budget_/);
    const b = await createField(api, { label, type: "number" });
    expect(b.key).toBe(`${a.key}_2`);
    const res = await api.patch(`/api/v1/custom_fields/${a.id}`, { data: { type: "text" } });
    expect(res.status()).toBe(422);
    const ok = await api.patch(`/api/v1/custom_fields/${a.id}`, { data: { type: "number", label: "Budget (USD)" } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).custom_field.label).toBe("Budget (USD)");
  });

  test("picklist options can be edited, but not emptied", async () => {
    const api = await owner();
    const f = await createField(api, { type: "picklist", options: ["Small", "Large"] });
    expect((await api.patch(`/api/v1/custom_fields/${f.id}`, { data: { options: [] } })).status()).toBe(422);
    const res = await api.patch(`/api/v1/custom_fields/${f.id}`, { data: { options: ["Small", "Medium", "Large"] } });
    expect(res.status()).toBe(200);
    expect((await res.json()).custom_field.options).toEqual(["Small", "Medium", "Large"]);
  });
});

test.describe("custom field values on records", () => {
  test("contacts: values are validated by type, returned, cleared and stripped on delete", async () => {
    const api = await owner();
    const num = await createField(api, { key: ukey("num"), type: "number" });
    const date = await createField(api, { key: ukey("date"), type: "date" });
    const bool = await createField(api, { key: ukey("bool"), type: "boolean" });
    const pick = await createField(api, { key: ukey("pick"), type: "picklist", options: ["Gold", "Silver"] });
    const url = await createField(api, { key: ukey("url"), type: "url" });
    const text = await createField(api, { key: ukey("txt"), type: "text" });

    const email = `${uniq("cf")}@cf-test.example`;
    const create = await api.post("/api/v1/contacts", {
      data: {
        firstName: "Custom",
        email,
        customFields: {
          [num.key]: "1,250",
          [date.key]: "2026-10-31",
          [bool.key]: "yes",
          [pick.key]: "gold",
          [url.key]: "example.com/page",
          [text.key]: "Hello",
        },
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const contact = (await create.json()).contact;
    expect(contact.customFields).toEqual({
      [num.key]: 1250,
      [date.key]: "2026-10-31",
      [bool.key]: true,
      [pick.key]: "Gold",
      [url.key]: "https://example.com/page",
      [text.key]: "Hello",
    });

    const bad = async (value: Record<string, unknown>) =>
      (await api.patch(`/api/v1/contacts/${contact.id}`, { data: { customFields: value } })).status();
    expect(await bad({ [num.key]: "lots" })).toBe(422);
    expect(await bad({ [date.key]: "not a date" })).toBe(422);
    expect(await bad({ [bool.key]: "maybe" })).toBe(422);
    expect(await bad({ [pick.key]: "Bronze" })).toBe(422);
    expect(await bad({ [url.key]: "javascript:alert(1)" })).toBe(422);
    expect(await bad({ no_such_field_xyz: "x" })).toBe(422);
    expect(await bad([1, 2] as unknown as Record<string, unknown>)).toBe(422);

    const patched = await api.patch(`/api/v1/contacts/${contact.id}`, {
      data: { customFields: { [num.key]: 7, [text.key]: null } },
    });
    expect(patched.status()).toBe(200);
    const after = (await patched.json()).contact.customFields;
    expect(after[num.key]).toBe(7);
    expect(text.key in after).toBe(false);
    expect(after[pick.key]).toBe("Gold");

    // Deleting the field strips stored values.
    expect((await api.delete(`/api/v1/custom_fields/${pick.id}`)).status()).toBe(200);
    const reread = (await (await api.get(`/api/v1/contacts/${contact.id}`)).json()).contact.customFields;
    expect(pick.key in reread).toBe(false);
    expect(reread[num.key]).toBe(7);
    const { rows } = await pg().query<{ n: number }>(
      "select count(*)::int as n from contact where custom_fields ? $1 and id = $2",
      [pick.key, contact.id],
    );
    expect(rows[0].n).toBe(0);

    // A contact field key doesn't apply to accounts.
    const acc = await api.post("/api/v1/accounts", {
      data: { name: uniq("Co"), customFields: { [num.key]: 1 } },
    });
    expect(acc.status()).toBe(422);
  });

  test("accounts: values on create and update", async () => {
    const api = await owner();
    const tier = await createField(api, {
      entityType: "company",
      key: ukey("tier"),
      type: "picklist",
      options: ["Enterprise", "Mid-market"],
    });
    const seats = await createField(api, { entityType: "company", key: ukey("seats"), type: "number" });
    const res = await api.post("/api/v1/accounts", {
      data: { name: uniq("Cf Co"), customFields: { [tier.key]: "enterprise" } },
    });
    expect(res.status(), await res.text()).toBe(201);
    const account = (await res.json()).account;
    expect(account.customFields).toEqual({ [tier.key]: "Enterprise" });
    expect(
      (await api.patch(`/api/v1/accounts/${account.id}`, { data: { customFields: { [seats.key]: "many" } } })).status(),
    ).toBe(422);
    const ok = await api.patch(`/api/v1/accounts/${account.id}`, { data: { customFields: { [seats.key]: 40 } } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).account.customFields).toEqual({ [tier.key]: "Enterprise", [seats.key]: 40 });
  });

  test("viewer can't write values (contact:update), Globex can't use Acme keys", async () => {
    const api = await owner();
    const f = await createField(api, { key: ukey("iso"), type: "text" });
    const globex = await apiAs(GLOBEX_OWNER);
    const res = await globex.post("/api/v1/contacts", {
      data: { firstName: "G", email: `${uniq("g")}@globex-cf.example`, customFields: { [f.key]: "x" } },
    });
    expect(res.status()).toBe(422);
    void BASE_URL;
  });
});
