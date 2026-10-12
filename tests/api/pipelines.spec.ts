import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAsRole } from "../support/session";
import { db, EVIL_ORIGIN, freshWorkspace, globexApi, uniq } from "./admin-helpers";

interface Stage {
  id: string;
  name: string;
  type: "open" | "won" | "lost";
  probability: number | null;
  legacyStage: string;
  dealCount: number;
}
interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Stage[];
}

const STAGES = [
  { name: "Discovery", type: "open", probability: 10 },
  { name: "Demo", type: "open", probability: 40 },
  { name: "Won", type: "won" },
  { name: "Lost", type: "lost" },
];

async function newPipeline(api?: APIRequestContext, name = uniq("Pipe")): Promise<Pipeline> {
  const client = api ?? (await apiAsRole("owner"));
  const res = await client.post("/api/v1/pipelines", { data: { name, stages: STAGES } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).pipeline;
}

async function removePipeline(id: string) {
  const owner = await apiAsRole("owner");
  const list = (await (await owner.get("/api/v1/pipelines")).json()).pipelines as Pipeline[];
  const fallback = list.find((p) => p.isDefault && p.id !== id) ?? list.find((p) => p.id !== id);
  await owner.delete(`/api/v1/pipelines/${id}`, { data: { moveDealsToPipelineId: fallback?.id } });
}

test.describe.configure({ timeout: 240_000 });

test.describe("pipelines API", () => {
  test("list: every role per matrix, 401 signed out, default pipeline exists", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/pipelines");
      expect(res.status(), role).toBe(expected(role, "deal:read"));
      if (res.ok()) {
        const pipelines = (await res.json()).pipelines as Pipeline[];
        expect(pipelines.filter((p) => p.isDefault)).toHaveLength(1);
      }
    }
    expect((await (await anonymous()).get("/api/v1/pipelines")).status()).toBe(401);
  });

  test("create: every role per matrix; validation of the stage list", async () => {
    const created: string[] = [];
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).post("/api/v1/pipelines", {
        data: { name: uniq(role), stages: STAGES },
      });
      expect(res.status(), role).toBe(expected(role, "pipeline:manage", 201));
      if (res.ok()) {
        const p = (await res.json()).pipeline as Pipeline;
        created.push(p.id);
        expect(p.stages.map((s) => s.type)).toEqual(["open", "open", "won", "lost"]);
        expect(p.stages.find((s) => s.type === "won")?.probability).toBe(100);
        expect(p.isDefault).toBe(false);
      }
    }
    const owner = await apiAsRole("owner");
    const bad = [
      [
        { name: "A", type: "open" },
        { name: "Lost", type: "lost" },
        { name: "B", type: "open" },
      ],
      [
        { name: "A", type: "open" },
        { name: "W", type: "won" },
        { name: "W2", type: "won" },
        { name: "L", type: "lost" },
      ],
      [
        { name: "A", type: "open" },
        { name: "B", type: "open" },
        { name: "L", type: "lost" },
      ],
      [
        { name: "A", type: "open" },
        { name: "W", type: "won" },
        { name: "A", type: "open" },
        { name: "L", type: "lost" },
      ],
      [
        { name: "W", type: "won" },
        { name: "A", type: "open" },
        { name: "L", type: "lost" },
      ],
      [
        { name: "", type: "open" },
        { name: "W", type: "won" },
        { name: "L", type: "lost" },
      ],
      [
        { name: "A", type: "maybe" },
        { name: "W", type: "won" },
        { name: "L", type: "lost" },
      ],
    ];
    for (const stages of bad) {
      const res = await owner.post("/api/v1/pipelines", { data: { name: "Bad", stages } });
      expect(res.status(), JSON.stringify(stages)).toBe(422);
    }
    expect((await owner.post("/api/v1/pipelines", { data: {} })).status()).toBe(422);
    for (const id of created) await removePipeline(id);
  });

  test("get, rename, replace stages, delete: every role per matrix", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const p = await newPipeline();
      expect((await api.get(`/api/v1/pipelines/${p.id}`)).status(), role).toBe(expected(role, "deal:read"));
      const rename = await api.patch(`/api/v1/pipelines/${p.id}`, { data: { name: `${p.name} renamed` } });
      expect(rename.status(), role).toBe(expected(role, "pipeline:manage"));
      const stages = [
        ...p.stages.slice(0, 2),
        { name: "Proposal", type: "open", probability: 60 },
        ...p.stages.slice(2),
      ];
      const put = await api.put(`/api/v1/pipelines/${p.id}/stages`, { data: { stages } });
      expect(put.status(), role).toBe(expected(role, "pipeline:manage"));
      if (put.ok()) {
        const body = (await put.json()).pipeline as Pipeline;
        expect(body.stages.map((s) => s.name)).toEqual(["Discovery", "Demo", "Proposal", "Won", "Lost"]);
        expect(body.stages[0].id).toBe(p.stages[0].id);
      }
      const del = await api.delete(`/api/v1/pipelines/${p.id}`);
      expect(del.status(), role).toBe(expected(role, "pipeline:manage"));
      if (!del.ok()) await removePipeline(p.id);
    }
    const owner = await apiAsRole("owner");
    expect((await owner.get(`/api/v1/pipelines/${crypto.randomUUID()}`)).status()).toBe(404);
    expect((await owner.patch(`/api/v1/pipelines/${crypto.randomUUID()}`, { data: { name: "x" } })).status()).toBe(404);
  });

  test("stages with deals can only be removed when their deals move", async () => {
    const owner = await apiAsRole("owner");
    const p = await newPipeline();
    const demo = p.stages[1];
    const deal = await owner.post("/api/v1/opportunities", {
      data: { name: uniq("On demo"), pipelineId: p.id, stageId: demo.id, amount: 300 },
    });
    expect(deal.status(), await deal.text()).toBe(201);
    const dealId = (await deal.json()).opportunity.id;
    const without = p.stages.filter((s) => s.id !== demo.id);

    const refused = await owner.put(`/api/v1/pipelines/${p.id}/stages`, { data: { stages: without } });
    expect(refused.status()).toBe(422);
    expect(JSON.stringify(await refused.json())).toContain("Choose a remaining stage");

    const otherPipeline = await newPipeline();
    const foreign = await owner.put(`/api/v1/pipelines/${p.id}/stages`, {
      data: { stages: [otherPipeline.stages[0], ...without.slice(1)] },
    });
    expect(foreign.status()).toBe(422);

    const moved = await owner.put(`/api/v1/pipelines/${p.id}/stages`, {
      data: { stages: without, moveDealsTo: { [demo.id]: p.stages[0].id } },
    });
    expect(moved.status(), await moved.text()).toBe(200);
    const after = (await (await owner.get(`/api/v1/opportunities/${dealId}`)).json()).opportunity;
    expect(after).toMatchObject({ stageId: p.stages[0].id, stageName: "Discovery", stage: "qualify" });

    // Changing a stage's type keeps deal.stage in sync with the closest legacy value.
    const flipped = await owner.put(`/api/v1/pipelines/${p.id}/stages`, {
      data: {
        stages: [{ ...without[0], name: "Negotiating terms" }, ...without.slice(1)],
      },
    });
    expect(flipped.status()).toBe(200);
    expect((await (await owner.get(`/api/v1/opportunities/${dealId}`)).json()).opportunity.stage).toBe("negotiation");

    // A pipeline with deals can only be deleted into another pipeline.
    expect((await owner.delete(`/api/v1/pipelines/${p.id}`)).status()).toBe(422);
    const del = await owner.delete(`/api/v1/pipelines/${p.id}`, { data: { moveDealsToPipelineId: otherPipeline.id } });
    expect(del.status(), await del.text()).toBe(200);
    const moved2 = (await (await owner.get(`/api/v1/opportunities/${dealId}`)).json()).opportunity;
    expect(moved2).toMatchObject({ pipelineId: otherPipeline.id, stageId: otherPipeline.stages[0].id });
    await owner.delete(`/api/v1/opportunities/${dealId}`);
    await removePipeline(otherPipeline.id);
  });

  test("default pipeline: switching the default, keeping at least one pipeline (fresh workspace)", async () => {
    const ws = await freshWorkspace();
    const list = (await (await ws.api.get("/api/v1/pipelines")).json()).pipelines as Pipeline[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Pipeline 1", isDefault: true });
    expect(list[0].stages.map((s) => [s.name, s.type])).toEqual([
      ["Lead", "open"],
      ["Sales qualified", "open"],
      ["Meeting booked", "open"],
      ["Negotiation", "open"],
      ["Contract sent", "open"],
      ["Closed won", "won"],
      ["Closed lost", "lost"],
    ]);
    expect((await ws.api.delete(`/api/v1/pipelines/${list[0].id}`)).status()).toBe(422);
    const second = await newPipeline(ws.api);
    const made = await ws.api.patch(`/api/v1/pipelines/${second.id}`, { data: { isDefault: true } });
    expect((await made.json()).pipeline.isDefault).toBe(true);
    const deal = await ws.api.post("/api/v1/opportunities", { data: { name: "Lands in the default" } });
    expect((await deal.json()).opportunity.pipelineId).toBe(second.id);
    expect(
      (await ws.api.delete(`/api/v1/pipelines/${second.id}`, { data: { moveDealsToPipelineId: list[0].id } })).status(),
    ).toBe(200);
    const again = (await (await ws.api.get("/api/v1/pipelines")).json()).pipelines as Pipeline[];
    expect(again).toHaveLength(1);
    expect(again[0].isDefault).toBe(true);
  });

  test("existing deals move onto the default pipeline on first use, mapped by legacy stage", async () => {
    const ws = await freshWorkspace();
    const legacy = ["qualify", "meeting", "proposal", "negotiation", "won", "lost"];
    const ids: string[] = [];
    for (const stage of legacy) {
      const id = crypto.randomUUID();
      ids.push(id);
      await db().query("insert into deal (id, organization_id, name, stage) values ($1, $2, $3, $4)", [
        id,
        ws.organizationId,
        `Legacy ${stage}`,
        stage,
      ]);
    }
    const list = (await (await ws.api.get("/api/v1/pipelines")).json()).pipelines as Pipeline[];
    const { rows } = await db().query<{ stage: string; name: string; pipeline_id: string }>(
      `select d.stage, s.name, d.pipeline_id from deal d join pipeline_stage s on s.id = d.stage_id
       where d.id = any($1) order by d.name`,
      [ids],
    );
    const byLegacy = Object.fromEntries(rows.map((r) => [r.stage, r.name]));
    expect(byLegacy).toEqual({
      qualify: "Lead",
      meeting: "Meeting booked",
      proposal: "Contract sent",
      negotiation: "Negotiation",
      won: "Closed won",
      lost: "Closed lost",
    });
    expect(new Set(rows.map((r) => r.pipeline_id))).toEqual(new Set([list[0].id]));
    // Search still reports the legacy totals the overview uses.
    const search = await (await ws.api.post("/api/v1/opportunities/search", { data: {} })).json();
    expect(search.stage_totals.find((t: { stage: string }) => t.stage === "won").count).toBe(1);
  });

  test("Globex can't read or change Acme pipelines; cross-site writes are refused", async () => {
    const p = await newPipeline();
    const globex = await globexApi();
    expect((await globex.get(`/api/v1/pipelines/${p.id}`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/pipelines/${p.id}`, { data: { name: "x" } })).status()).toBe(404);
    expect((await globex.put(`/api/v1/pipelines/${p.id}/stages`, { data: { stages: STAGES } })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/pipelines/${p.id}`)).status()).toBe(404);
    const list = (await (await globex.get("/api/v1/pipelines")).json()).pipelines as Pipeline[];
    expect(list.some((x) => x.id === p.id)).toBe(false);
    const deal = await globex.post("/api/v1/opportunities", { data: { name: "x", pipelineId: p.id } });
    expect(deal.status()).toBe(422);
    const stageDeal = await globex.post("/api/v1/opportunities", { data: { name: "x", stageId: p.stages[0].id } });
    expect(stageDeal.status()).toBe(422);

    const owner = await apiAsRole("owner");
    expect((await owner.post("/api/v1/pipelines", { headers: EVIL_ORIGIN, data: { name: "x" } })).status()).toBe(403);
    expect(
      (await owner.patch(`/api/v1/pipelines/${p.id}`, { headers: EVIL_ORIGIN, data: { name: "x" } })).status(),
    ).toBe(403);
    expect(
      (
        await owner.put(`/api/v1/pipelines/${p.id}/stages`, { headers: EVIL_ORIGIN, data: { stages: STAGES } })
      ).status(),
    ).toBe(403);
    expect((await owner.delete(`/api/v1/pipelines/${p.id}`, { headers: EVIL_ORIGIN })).status()).toBe(403);
    await removePipeline(p.id);
  });
});
