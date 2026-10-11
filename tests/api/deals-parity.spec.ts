import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAsRole } from "../support/session";
import { acmeOrgId, db, EVIL_ORIGIN, globexApi, insertContact, uniq, userIdOf } from "./admin-helpers";

test.describe.configure({ timeout: 240_000 });

interface Stage {
  id: string;
  name: string;
  type: string;
}
interface Pipeline {
  id: string;
  isDefault: boolean;
  stages: Stage[];
}

async function defaultPipeline(): Promise<Pipeline> {
  const list = (await (await (await apiAsRole("owner")).get("/api/v1/pipelines")).json()).pipelines as Pipeline[];
  const found = list.find((p) => p.isDefault);
  if (!found) throw new Error("no default pipeline");
  return found;
}

test.describe("deals parity: pipelines, stages, custom fields, activity", () => {
  test("create and move with pipeline + stage ids; legacy stage stays in sync; events recorded", async () => {
    const owner = await apiAsRole("owner");
    const p = await defaultPipeline();
    const contract = p.stages.find((s) => s.name === "Contract sent") as Stage;
    const won = p.stages.find((s) => s.type === "won") as Stage;
    const res = await owner.post("/api/v1/opportunities", {
      data: { name: uniq("Parity"), pipelineId: p.id, stageId: contract.id, amount: 4200 },
    });
    expect(res.status(), await res.text()).toBe(201);
    const deal = (await res.json()).opportunity;
    expect(deal).toMatchObject({
      pipelineId: p.id,
      stageId: contract.id,
      stageName: "Contract sent",
      stageType: "open",
      stage: "proposal",
      isClosed: false,
    });

    const moved = await owner.patch(`/api/v1/opportunities/${deal.id}`, { data: { stageId: won.id } });
    expect((await moved.json()).opportunity).toMatchObject({ stage: "won", isWon: true, stageName: "Closed won" });

    for (const role of ROLES) {
      const act = await (await apiAsRole(role)).get(`/api/v1/opportunities/${deal.id}/activity`);
      expect(act.status(), role).toBe(expected(role, "deal:read"));
      if (act.ok()) {
        const types = (await act.json()).activities.map((a: { type: string }) => a.type);
        expect(types).toEqual(expect.arrayContaining(["deal_created", "deal_stage_changed"]));
      }
    }
    // Only stageId is enough: the pipeline follows the stage.
    const other = await owner.post("/api/v1/pipelines", {
      data: {
        name: uniq("Side"),
        stages: [
          { name: "Open", type: "open" },
          { name: "Won", type: "won" },
          { name: "Lost", type: "lost" },
        ],
      },
    });
    const side = (await other.json()).pipeline as Pipeline;
    const viaStage = await owner.patch(`/api/v1/opportunities/${deal.id}`, { data: { stageId: side.stages[0].id } });
    expect((await viaStage.json()).opportunity.pipelineId).toBe(side.id);
    // Moving pipelines without a stage lands on the first open stage.
    const back = await owner.patch(`/api/v1/opportunities/${deal.id}`, { data: { pipelineId: p.id } });
    expect((await back.json()).opportunity.stageId).toBe(p.stages[0].id);

    // A stage from another pipeline, or ids that don't exist, are field errors.
    const mismatch = await owner.post("/api/v1/opportunities", {
      data: { name: "x", pipelineId: p.id, stageId: side.stages[0].id },
    });
    expect(mismatch.status()).toBe(422);
    expect((await owner.post("/api/v1/opportunities", { data: { name: "x", pipelineId: "nope" } })).status()).toBe(422);
    expect((await owner.post("/api/v1/opportunities", { data: { name: "x", stageId: "nope" } })).status()).toBe(422);
    await owner.delete(`/api/v1/pipelines/${side.id}`, { data: { moveDealsToPipelineId: p.id } });
    await owner.delete(`/api/v1/opportunities/${deal.id}`);
  });

  test("custom field values are validated against the workspace's deal fields", async () => {
    const owner = await apiAsRole("owner");
    const key = `deal_${Date.now().toString(36)}`;
    const field = await owner.post("/api/v1/custom_fields", {
      data: { entityType: "deal", label: `Source ${key}`, key, type: "picklist", options: ["Inbound", "Outbound"] },
    });
    expect(field.status(), await field.text()).toBe(201);
    const fieldId = (await field.json()).custom_field?.id ?? (await field.json()).customField?.id;
    const ok = await owner.post("/api/v1/opportunities", {
      data: { name: uniq("CF"), customFields: { [key]: "Inbound" } },
    });
    expect(ok.status(), await ok.text()).toBe(201);
    const deal = (await ok.json()).opportunity;
    expect(deal.customFields[key]).toBe("Inbound");
    expect(
      (await owner.post("/api/v1/opportunities", { data: { name: "x", customFields: { [key]: "Partner" } } })).status(),
    ).toBe(422);
    expect(
      (await owner.post("/api/v1/opportunities", { data: { name: "x", customFields: { nope_field: "1" } } })).status(),
    ).toBe(422);
    const cleared = await owner.patch(`/api/v1/opportunities/${deal.id}`, { data: { customFields: { [key]: null } } });
    expect((await cleared.json()).opportunity.customFields[key]).toBeNull();
    await owner.delete(`/api/v1/opportunities/${deal.id}`);
    if (fieldId) await owner.delete(`/api/v1/custom_fields/${fieldId}`);
  });

  test("search filters: pipeline, stages, owners, amount and close date ranges; sort; per-stage totals", async () => {
    const owner = await apiAsRole("owner");
    const p = await defaultPipeline();
    const tag = uniq("Filter");
    const manager = await userIdOf(ACME.manager);
    const mk = async (suffix: string, data: Record<string, unknown>) => {
      const res = await owner.post("/api/v1/opportunities", {
        data: { name: `${tag} ${suffix}`, pipelineId: p.id, ...data },
      });
      expect(res.status(), await res.text()).toBe(201);
      return (await res.json()).opportunity.id as string;
    };
    await mk("a", { stageId: p.stages[0].id, amount: 100, closeDate: "2026-11-01" });
    await mk("b", { stageId: p.stages[1].id, amount: 900, closeDate: "2026-12-15", ownerId: manager });
    await mk("c", { stageId: p.stages[1].id, amount: 5000, closeDate: "2027-02-01" });
    const search = async (data: Record<string, unknown>) =>
      (await (await owner.post("/api/v1/opportunities/search", { data: { q: tag, ...data } })).json()) as {
        opportunities: { name: string; amount: number }[];
        pipeline_stage_totals: { stageId: string; count: number; amount: number }[];
      };
    expect((await search({ pipelineId: p.id })).opportunities).toHaveLength(3);
    expect((await search({ stageIds: [p.stages[1].id] })).opportunities).toHaveLength(2);
    expect((await search({ ownerIds: [manager] })).opportunities.map((d) => d.name)).toEqual([`${tag} b`]);
    expect((await search({ amountMin: 500, amountMax: 1000 })).opportunities).toHaveLength(1);
    expect((await search({ closeDateFrom: "2026-12-01", closeDateTo: "2026-12-31" })).opportunities).toHaveLength(1);
    expect(
      (await search({ sort_by_field: "amount", sort_ascending: true })).opportunities.map((d) => d.amount),
    ).toEqual([100, 900, 5000]);
    const totals = (await search({})).pipeline_stage_totals;
    expect(totals.find((t) => t.stageId === p.stages[1].id)).toMatchObject({ count: 2, amount: 5900 });
    const viaGet = await owner.get(
      `/api/v1/opportunities/search?q=${encodeURIComponent(tag)}&stageIds=${p.stages[0].id}&stageIds=${p.stages[1].id}`,
    );
    expect((await viaGet.json()).opportunities).toHaveLength(3);
  });

  test("CSV import: every role per matrix; rows link companies, contacts and owners; bad rows reported", async () => {
    const org = await acmeOrgId();
    const domain = `${uniq("imp")}.example.test`;
    const companyId = crypto.randomUUID();
    await db().query(
      "insert into company (id, organization_id, name, domain, source) values ($1, $2, $3, $4, 'test')",
      [companyId, org, "Import Co", domain],
    );
    const email = `${uniq("imp")}@example.test`;
    const contactId = await insertContact(org, { email });
    const tag = uniq("CSV");
    const csv = [
      "Deal name,Company domain,Contact email,Amount,Stage,Close date,Owner email",
      `${tag} one,${domain},${email},"12,500",Negotiation,2026-12-01,${ACME.manager}`,
      `${tag} two,,,300,won,,`,
      `${tag} three,,,abc,Lead,,`,
      `${tag} four,,,10,Nowhere,,`,
    ].join("\n");
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).post("/api/v1/opportunities/import", {
        data: { csv: csv.replaceAll(tag, `${tag}-${role}`) },
      });
      expect(res.status(), role).toBe(expected(role, "deal:create", 201));
      if (res.ok()) {
        const report = (await res.json()).import;
        expect(report).toMatchObject({ total: 4, created: 2, skipped: 2 });
        expect(report.errors.map((e: { row: number }) => e.row)).toEqual([4, 5]);
      }
    }
    const owner = await apiAsRole("owner");
    const found = (
      await (
        await owner.post("/api/v1/opportunities/search", { data: { q: `${tag}-owner`, sort_by_field: "name" } })
      ).json()
    ).opportunities;
    const one = found.find((d: { name: string }) => d.name === `${tag}-owner one`);
    expect(one).toMatchObject({
      amount: 12500,
      stageName: "Negotiation",
      closeDate: "2026-12-01",
      company: { id: companyId },
      contact: { id: contactId },
      owner: { email: ACME.manager },
    });
    expect(found.find((d: { name: string }) => d.name === `${tag}-owner two`).stage).toBe("won");
    expect((await owner.post("/api/v1/opportunities/import", { data: { csv: "Foo,Bar\n1,2" } })).status()).toBe(422);
    expect((await (await anonymous()).post("/api/v1/opportunities/import", { data: { csv } })).status()).toBe(401);
    expect((await owner.post("/api/v1/opportunities/import", { headers: EVIL_ORIGIN, data: { csv } })).status()).toBe(
      403,
    );
  });

  test("analytics: every role per matrix; value by stage, win rate, average size, months, owners", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/opportunities/analytics");
      expect(res.status(), role).toBe(expected(role, "deal:read"));
    }
    const owner = await apiAsRole("owner");
    const p = await defaultPipeline();
    const body = await (await owner.get(`/api/v1/opportunities/analytics?pipelineId=${p.id}`)).json();
    expect(body.byMonth).toHaveLength(12);
    expect(body.byStage.length).toBeGreaterThan(0);
    expect(body.byStage.every((s: { type: string }) => ["open", "won", "lost"].includes(s.type))).toBe(true);
    expect(body.totals).toHaveProperty("winRate");
    expect(body.totals).toHaveProperty("averageDealSize");
    expect(Array.isArray(body.byOwner)).toBe(true);
    expect((await (await anonymous()).get("/api/v1/opportunities/analytics")).status()).toBe(401);
  });

  test("Globex isolation for deal activity and stage ids", async () => {
    const owner = await apiAsRole("owner");
    const res = await owner.post("/api/v1/opportunities", { data: { name: uniq("Iso") } });
    const deal = (await res.json()).opportunity;
    const globex = await globexApi();
    expect((await globex.get(`/api/v1/opportunities/${deal.id}/activity`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/opportunities/${deal.id}`, { data: { stageId: deal.stageId } })).status()).toBe(
      404,
    );
    const globexAnalytics = await (await globex.get("/api/v1/opportunities/analytics")).json();
    expect(globexAnalytics.byStage.some((s: { stageId: string }) => s.stageId === deal.stageId)).toBe(false);
    await owner.delete(`/api/v1/opportunities/${deal.id}`);
  });
});
