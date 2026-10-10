import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAsRole, apiWithKey } from "../support/session";
import {
  acmeKeyClient,
  acmeOrgId,
  EVIL_ORIGIN,
  globexApi,
  globexKey,
  insertContact,
  uniq,
  userIdOf,
} from "./admin-helpers";

async function newDeal(data: Record<string, unknown> = {}) {
  const owner = await apiAsRole("owner");
  const res = await owner.post("/api/v1/opportunities", { data: { name: uniq("Deal"), amount: 1000, ...data } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).opportunity as { id: string; name: string; stage: string; amount: number };
}

test.describe("deals (opportunities) API", () => {
  test("stages and search: every role per matrix, 401 when signed out", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const stages = await api.get("/api/v1/opportunity_stages");
      expect(stages.status(), role).toBe(expected(role, "deal:read"));
      const search = await api.post("/api/v1/opportunities/search", { data: {} });
      expect(search.status(), role).toBe(expected(role, "deal:read"));
      const viaGet = await api.get("/api/v1/opportunities/search?open=true");
      expect(viaGet.status(), role).toBe(expected(role, "deal:read"));
    }
    const anon = await anonymous();
    expect((await anon.get("/api/v1/opportunity_stages")).status()).toBe(401);
    expect((await anon.post("/api/v1/opportunities/search", { data: {} })).status()).toBe(401);
    const stages = await (await (await apiAsRole("viewer")).get("/api/v1/opportunity_stages")).json();
    expect(stages.opportunity_stages.map((s: { id: string }) => s.id)).toEqual([
      "qualify",
      "meeting",
      "proposal",
      "negotiation",
      "won",
      "lost",
    ]);
  });

  test("search returns per-stage totals and honours filters", async () => {
    const owner = await apiAsRole("owner");
    const name = uniq("Totals");
    await newDeal({ name: `${name} a`, stage: "negotiation", amount: 700 });
    await newDeal({ name: `${name} b`, stage: "negotiation", amount: "300" });
    await newDeal({ name: `${name} c`, stage: "lost", amount: 50 });
    const body = await (await owner.post("/api/v1/opportunities/search", { data: { q: name } })).json();
    expect(body.opportunities).toHaveLength(3);
    const negotiation = body.stage_totals.find((t: { stage: string }) => t.stage === "negotiation");
    expect(negotiation).toMatchObject({ count: 2, amount: 1000 });
    const open = await (await owner.post("/api/v1/opportunities/search", { data: { q: name, open: true } })).json();
    expect(open.opportunities).toHaveLength(2);
    const lost = await (
      await owner.get(`/api/v1/opportunities/search?q=${encodeURIComponent(name)}&stage=lost`)
    ).json();
    expect(lost.opportunities).toHaveLength(1);
    const sorted = await (
      await owner.post("/api/v1/opportunities/search", { data: { q: name, sort_by_field: "amount" } })
    ).json();
    expect(sorted.opportunities.map((d: { amount: number }) => d.amount)).toEqual([700, 300, 50]);
  });

  test("create: every role per matrix, defaults, validation", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.post("/api/v1/opportunities", { data: { name: uniq(role), amount: 10 } });
      expect(res.status(), role).toBe(expected(role, "deal:create", 201));
      if (res.ok()) {
        const deal = (await res.json()).opportunity;
        expect(deal.stage).toBe("qualify");
        expect(deal.currency).toBe("USD");
        expect(deal.owner.email).toBe(ACME[role]);
      }
    }
    const owner = await apiAsRole("owner");
    expect((await owner.post("/api/v1/opportunities", { data: {} })).status()).toBe(422);
    expect((await owner.post("/api/v1/opportunities", { data: { name: "x", amount: "12,000" } })).status()).toBe(422);
    expect((await owner.post("/api/v1/opportunities", { data: { name: "x", stage: "closed" } })).status()).toBe(422);
    expect((await owner.post("/api/v1/opportunities", { data: { name: "x", amount: -5 } })).status()).toBe(422);
    const outsider = await owner.post("/api/v1/opportunities", {
      data: { name: "x", ownerId: await userIdOf("owner@globex.test") },
    });
    expect(outsider.status()).toBe(422);
    const full = await owner.post("/api/v1/opportunities", {
      data: {
        name: uniq("Full"),
        amount: "25000",
        currency: "eur",
        closeDate: "2026-12-31",
        stage: "proposal",
        ownerId: await userIdOf(ACME.manager),
      },
    });
    expect(full.status()).toBe(201);
    expect((await full.json()).opportunity).toMatchObject({
      amount: 25000,
      currency: "EUR",
      closeDate: "2026-12-31",
      stage: "proposal",
    });
  });

  test("get, update, delete: every role per matrix", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const deal = await newDeal();
      expect((await api.get(`/api/v1/opportunities/${deal.id}`)).status(), role).toBe(expected(role, "deal:read"));
      const patch = await api.patch(`/api/v1/opportunities/${deal.id}`, { data: { stage: "meeting", amount: 5 } });
      expect(patch.status(), role).toBe(expected(role, "deal:update"));
      if (patch.ok()) expect((await patch.json()).opportunity).toMatchObject({ stage: "meeting", amount: 5 });
      expect((await api.delete(`/api/v1/opportunities/${deal.id}`)).status(), role).toBe(expected(role, "deal:delete"));
    }
    const owner = await apiAsRole("owner");
    const deal = await newDeal();
    expect((await owner.patch(`/api/v1/opportunities/${deal.id}`, { data: {} })).status()).toBe(422);
    expect((await owner.patch(`/api/v1/opportunities/${deal.id}`, { data: { stage: "nope" } })).status()).toBe(422);
    expect((await owner.get(`/api/v1/opportunities/${crypto.randomUUID()}`)).status()).toBe(404);
  });

  test("deals for a contact", async () => {
    const org = await acmeOrgId();
    const contactId = await insertContact(org, { email: `${uniq("dc")}@example.com` });
    const deal = await newDeal({ contactId });
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.get(`/api/v1/contacts/${contactId}/opportunities`);
      expect(res.status(), role).toBe(expected(role, "deal:read"));
      if (res.ok()) expect((await res.json()).opportunities.map((d: { id: string }) => d.id)).toEqual([deal.id]);
    }
    const unknown = await (await apiAsRole("owner")).post(`/api/v1/contacts/${crypto.randomUUID()}/opportunities`);
    expect((await unknown.json()).opportunities).toEqual([]);
    const globex = await (await globexApi()).get(`/api/v1/contacts/${contactId}/opportunities`);
    expect((await globex.json()).opportunities).toEqual([]);
  });

  test("Globex can't see or touch Acme deals", async () => {
    const deal = await newDeal();
    const globex = await globexApi();
    expect((await globex.get(`/api/v1/opportunities/${deal.id}`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/opportunities/${deal.id}`, { data: { name: "x" } })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/opportunities/${deal.id}`)).status()).toBe(404);
    const list = await (await globex.post("/api/v1/opportunities/search", { data: { per_page: 100 } })).json();
    expect(list.opportunities.some((d: { id: string }) => d.id === deal.id)).toBe(false);
    const contact = await insertContact(await acmeOrgId());
    expect((await globex.post("/api/v1/opportunities", { data: { name: "x", contactId: contact } })).status()).toBe(
      422,
    );
    const key = await apiWithKey((await globexKey()).secret);
    expect((await key.get(`/api/v1/opportunities/${deal.id}`)).status()).toBe(404);
  });

  test("API keys: role enforced", async () => {
    const viewer = await acmeKeyClient("viewer");
    expect((await viewer.post("/api/v1/opportunities/search", { data: {} })).status()).toBe(200);
    expect((await viewer.post("/api/v1/opportunities", { data: { name: "x" } })).status()).toBe(403);
    const member = await acmeKeyClient("member");
    const created = await member.post("/api/v1/opportunities", { data: { name: uniq("key deal") } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).opportunity.id;
    expect((await member.delete(`/api/v1/opportunities/${id}`)).status()).toBe(403);
    const manager = await acmeKeyClient("manager");
    expect((await manager.delete(`/api/v1/opportunities/${id}`)).status()).toBe(200);
  });

  test("cross-site cookie writes are refused; writes are audited", async () => {
    const owner = await apiAsRole("owner");
    expect((await owner.post("/api/v1/opportunities", { headers: EVIL_ORIGIN, data: { name: "x" } })).status()).toBe(
      403,
    );
    const deal = await newDeal();
    expect(
      (await owner.patch(`/api/v1/opportunities/${deal.id}`, { headers: EVIL_ORIGIN, data: { name: "y" } })).status(),
    ).toBe(403);
    await owner.patch(`/api/v1/opportunities/${deal.id}`, { data: { stage: "won" } });
    const log = await (await owner.get(`/api/v1/audit_logs?entityId=${deal.id}`)).json();
    const update = log.audit_logs.find((l: { action: string }) => l.action === "deal.update");
    expect(update.metadata).toMatchObject({ fromStage: "qualify", toStage: "won" });
  });
});
