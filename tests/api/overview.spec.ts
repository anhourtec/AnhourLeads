import { expect, test } from "@playwright/test";

import { ROLES } from "../support/matrix";
import { ACME, anonymous, apiAsRole, apiWithKey } from "../support/session";
import { acmeKeyClient, freshWorkspace, globexApi, globexKey, uniq, userIdOf } from "./admin-helpers";

test.describe("overview API", () => {
  test("every role can read the overview; 401 signed out", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/overview");
      expect(res.status(), role).toBe(200);
      const { overview } = await res.json();
      expect(overview.contacts).toBeGreaterThan(0);
      expect(overview.companies).toBeGreaterThan(0);
      expect(overview.pipeline.map((p: { stage: string }) => p.stage)).toEqual([
        "qualify",
        "meeting",
        "proposal",
        "negotiation",
      ]);
      expect(overview.verifiedEmailRate).toBeGreaterThanOrEqual(0);
      expect(overview.verifiedEmailRate).toBeLessThanOrEqual(1);
    }
    expect((await (await anonymous()).get("/api/v1/overview")).status()).toBe(401);
    expect((await (await acmeKeyClient("viewer")).get("/api/v1/overview")).status()).toBe(200);
  });

  test("counts follow the data: my tasks due today, pipeline, deals won this month", async () => {
    const viewer = await apiAsRole("viewer");
    const owner = await apiAsRole("owner");
    const before = (await (await viewer.get("/api/v1/overview")).json()).overview;

    const viewerId = await userIdOf(ACME.viewer);
    const dueSoon = new Date();
    dueSoon.setUTCHours(0, 30, 0, 0);
    await owner.post("/api/v1/tasks", {
      data: { title: uniq("Due today"), assigneeId: viewerId, dueAt: dueSoon.toISOString() },
    });
    const overdue = new Date(Date.now() - 3 * 864e5).toISOString();
    await owner.post("/api/v1/tasks", { data: { title: uniq("Overdue"), assigneeId: viewerId, dueAt: overdue } });
    await owner.post("/api/v1/opportunities", { data: { name: uniq("Pipeline"), stage: "negotiation", amount: 1234 } });
    await owner.post("/api/v1/opportunities", { data: { name: uniq("Won"), stage: "won", amount: 4321 } });

    const after = (await (await viewer.get("/api/v1/overview")).json()).overview;
    expect(after.myTasksDueToday).toBeGreaterThanOrEqual(before.myTasksDueToday + 2);
    expect(after.myTasksOverdue).toBeGreaterThanOrEqual(before.myTasksOverdue + 1);
    const neg = (o: { pipeline: { stage: string; amount: number }[] }) =>
      o.pipeline.find((p) => p.stage === "negotiation")?.amount ?? 0;
    expect(neg(after)).toBeGreaterThanOrEqual(neg(before) + 1234);
    expect(after.dealsWonThisMonth.amount).toBeGreaterThanOrEqual(before.dealsWonThisMonth.amount + 4321);
  });

  test("scoped to the workspace: Globex and a fresh workspace see only their own numbers", async () => {
    const fresh = await freshWorkspace();
    const { overview } = await (await fresh.api.get("/api/v1/overview")).json();
    expect(overview).toMatchObject({
      contacts: 0,
      companies: 0,
      verifiedEmailRate: null,
      activeSequences: 0,
      emailsSentLast7Days: 0,
      myTasksDueToday: 0,
      openPipelineValue: 0,
      dealsWonThisMonth: { count: 0, amount: 0 },
    });
    const globex = (await (await (await globexApi()).get("/api/v1/overview")).json()).overview;
    const acme = (await (await (await apiAsRole("owner")).get("/api/v1/overview")).json()).overview;
    expect(globex.contacts).not.toBe(acme.contacts);
    expect(globex.openPipelineValue).toBe(0);
    const key = await apiWithKey((await globexKey()).secret);
    expect((await (await key.get("/api/v1/overview")).json()).overview.openPipelineValue).toBe(0);
  });
});
