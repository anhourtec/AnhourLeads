import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { EVIL, owner, uniq } from "./_engage-parity";

type Kind = "email_templates" | "snippets";
const KINDS: Kind[] = ["email_templates", "snippets"];
const KEY = { email_templates: "email_template", snippets: "snippet" } as const;

function body(kind: Kind, extra: Record<string, unknown> = {}) {
  return kind === "email_templates"
    ? { name: uniq("tpl"), subject: "Hi {{first_name}}", body: "Hello {{first_name}}", ...extra }
    : { name: uniq("snip"), body: "Happy to share a short case study.", ...extra };
}

async function create(api: APIRequestContext, kind: Kind, extra: Record<string, unknown> = {}) {
  const res = await api.post(`/api/v1/${kind}`, { data: body(kind, extra) });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json())[KEY[kind]] as { id: string; ownerId: string; name: string };
}

for (const kind of KINDS) {
  test.describe(`${kind}`, () => {
    test("list and read for every role; create and update for members and up", async () => {
      for (const role of ROLES) {
        const api = await apiAsRole(role);
        expect((await api.get(`/api/v1/${kind}`)).status(), role).toBe(expected(role, "template:read"));
        const created = await api.post(`/api/v1/${kind}`, { data: body(kind) });
        expect(created.status(), role).toBe(expected(role, "template:create", 201));
        const target = await create(await owner(), kind);
        expect((await api.get(`/api/v1/${kind}/${target.id}`)).status(), role).toBe(expected(role, "template:read"));
        const patch = await api.patch(`/api/v1/${kind}/${target.id}`, { data: { name: uniq("renamed") } });
        expect(patch.status(), role).toBe(expected(role, "template:update"));
      }
    });

    test("delete: managers and up delete anything, members only their own", async () => {
      for (const role of ROLES) {
        const api = await apiAsRole(role);
        const othersItem = await create(await owner(), kind);
        const del = await api.delete(`/api/v1/${kind}/${othersItem.id}`);
        expect(del.status(), `${role} deletes someone else's`).toBe(
          role === "viewer" ? 403 : expected(role, "template:delete"),
        );
      }
      const member = await apiAsRole("member");
      const own = await create(member, kind);
      expect((await member.delete(`/api/v1/${kind}/${own.id}`)).status()).toBe(200);
      expect((await member.get(`/api/v1/${kind}/${own.id}`)).status()).toBe(404);
    });

    test("private items are only visible to their owner", async () => {
      const member = await apiAsRole("member");
      const mine = await create(member, kind, { shared: false });
      expect((await member.get(`/api/v1/${kind}/${mine.id}`)).status()).toBe(200);
      const manager = await apiAsRole("manager");
      expect((await manager.get(`/api/v1/${kind}/${mine.id}`)).status()).toBe(404);
      const list = (await (await manager.get(`/api/v1/${kind}`)).json())[kind];
      expect(list.some((t: { id: string }) => t.id === mine.id)).toBe(false);
      const search = (await (await member.get(`/api/v1/${kind}?q=${encodeURIComponent(mine.name)}`)).json())[kind];
      expect(search.map((t: { id: string }) => t.id)).toEqual([mine.id]);
    });

    test("invalid input is 422", async () => {
      const api = await owner();
      expect((await api.post(`/api/v1/${kind}`, { data: { name: "", body: "x" } })).status()).toBe(422);
      expect((await api.post(`/api/v1/${kind}`, { data: { name: "x", body: "   " } })).status()).toBe(422);
      expect((await api.post(`/api/v1/${kind}`, { data: { name: "x", body: "y", colour: "red" } })).status()).toBe(422);
      const item = await create(api, kind);
      expect((await api.patch(`/api/v1/${kind}/${item.id}`, { data: {} })).status()).toBe(422);
      expect((await api.patch(`/api/v1/${kind}/${item.id}`, { data: { name: "x".repeat(200) } })).status()).toBe(422);
    });

    test("401, CSRF 403 and Globex isolation 404", async () => {
      const anon = await anonymous();
      expect((await anon.get(`/api/v1/${kind}`)).status()).toBe(401);
      expect((await anon.post(`/api/v1/${kind}`, { data: body(kind) })).status()).toBe(401);
      expect((await anon.get(`/api/v1/${kind}/x`)).status()).toBe(401);
      expect((await anon.patch(`/api/v1/${kind}/x`, { data: {} })).status()).toBe(401);
      expect((await anon.delete(`/api/v1/${kind}/x`)).status()).toBe(401);

      const api = await owner();
      expect((await api.post(`/api/v1/${kind}`, { headers: EVIL, data: body(kind) })).status()).toBe(403);
      const item = await create(api, kind);
      expect((await api.patch(`/api/v1/${kind}/${item.id}`, { headers: EVIL, data: { name: "x" } })).status()).toBe(
        403,
      );
      expect((await api.delete(`/api/v1/${kind}/${item.id}`, { headers: EVIL })).status()).toBe(403);

      const globex = await apiAs(GLOBEX_OWNER);
      expect((await globex.get(`/api/v1/${kind}/${item.id}`)).status()).toBe(404);
      expect((await globex.patch(`/api/v1/${kind}/${item.id}`, { data: { name: "taken" } })).status()).toBe(404);
      expect((await globex.delete(`/api/v1/${kind}/${item.id}`)).status()).toBe(404);
      const theirs = (await (await globex.get(`/api/v1/${kind}`)).json())[kind];
      expect(theirs.some((t: { id: string }) => t.id === item.id)).toBe(false);
      expect((await api.get(`/api/v1/${kind}/${item.id}`)).status()).toBe(200);
    });
  });
}
