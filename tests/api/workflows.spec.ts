import "dotenv/config";

import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAsRole } from "../support/session";
import { EVIL_ORIGIN, globexApi, uniq } from "./admin-helpers";

test.describe.configure({ timeout: 240_000 });

const ALLOW_PRIVATE = process.env.CRAWLER_ALLOW_PRIVATE_HOSTS === "true";

/** A launchable workflow that can only ever enroll records with a unique title. */
function launchable(marker = uniq("wf")) {
  return {
    name: `Test ${marker}`,
    targetType: "contact",
    triggerType: "event",
    triggerEvent: "contact_created",
    enrollmentFilters: { title: marker },
    blocks: [{ id: "t1", type: "create_task", config: { title: "Say hello" } }],
  };
}

async function create(api: APIRequestContext, data: Record<string, unknown> = launchable()) {
  const res = await api.post("/api/v1/workflows", { data });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).workflow as { id: string; status: string; blocks: { config: Record<string, unknown> }[] };
}

async function archive(id: string) {
  await (await apiAsRole("owner")).post(`/api/v1/workflows/${id}/archive`);
}

test.describe("workflows API", () => {
  test("templates and list: every role per matrix; 401 signed out", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const templates = await api.get("/api/v1/workflow_templates");
      expect(templates.status(), role).toBe(expected(role, "workflow:read"));
      if (templates.ok()) {
        const list = (await templates.json()).workflow_templates as { id: string; kind: string }[];
        expect(list.length).toBeGreaterThanOrEqual(6);
        expect(list.map((t) => t.id)).toEqual(
          expect.arrayContaining([
            "icp-to-sequence",
            "new-hires",
            "replied-follow-up",
            "bounce-cleanup",
            "deal-won-notify",
          ]),
        );
      }
      expect((await api.get("/api/v1/workflows")).status(), role).toBe(expected(role, "workflow:read"));
    }
    const anon = await anonymous();
    expect((await anon.get("/api/v1/workflows")).status()).toBe(401);
    expect((await anon.get("/api/v1/workflow_templates")).status()).toBe(401);
    expect((await anon.post("/api/v1/workflows", { data: {} })).status()).toBe(401);
  });

  test("create (blank, from a template): every role per matrix", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const blank = await api.post("/api/v1/workflows", { data: {} });
      expect(blank.status(), role).toBe(expected(role, "workflow:create", 201));
      if (blank.ok()) {
        const wf = (await blank.json()).workflow;
        expect(wf).toMatchObject({ status: "draft", targetType: "contact", blocks: [], allowReenroll: true });
        expect(wf.name).toMatch(/^New workflow/);
        await archive(wf.id);
      }
    }
    const owner = await apiAsRole("owner");
    const fromTemplate = await create(owner, { templateId: "bounce-cleanup" });
    expect(fromTemplate.blocks.map((b) => (b as unknown as { type: string }).type)).toEqual([
      "update_record",
      "remove_from_sequence",
    ]);
    expect((await owner.post("/api/v1/workflows", { data: { templateId: "nope" } })).status()).toBe(422);
    await archive(fromTemplate.id);
  });

  test("get, update, launch, test, runs, pause, archive, delete: every role per matrix", async () => {
    const owner = await apiAsRole("owner");
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const wf = await create(owner);
      expect((await api.get(`/api/v1/workflows/${wf.id}`)).status(), role).toBe(expected(role, "workflow:read"));
      const patch = await api.patch(`/api/v1/workflows/${wf.id}`, {
        data: { description: "Updated", allowReenroll: false },
      });
      expect(patch.status(), role).toBe(expected(role, "workflow:update"));
      if (patch.ok())
        expect((await patch.json()).workflow).toMatchObject({ description: "Updated", allowReenroll: false });
      const launch = await api.post(`/api/v1/workflows/${wf.id}/launch`);
      expect(launch.status(), role).toBe(expected(role, "workflow:launch"));
      if (!launch.ok()) await owner.post(`/api/v1/workflows/${wf.id}/launch`);
      const contactId = (
        await (
          await owner.post("/api/v1/contacts", { data: { firstName: "Dry", email: `${uniq("dry")}@example.test` } })
        ).json()
      ).contact.id as string;
      const dry = await api.post(`/api/v1/workflows/${wf.id}/test`, { data: { entityId: contactId } });
      expect(dry.status(), role).toBe(expected(role, "workflow:read"));
      if (dry.ok()) {
        const result = (await dry.json()).test;
        expect(result.matchesFilters).toBe(false);
        expect(result.path.map((p: { type: string }) => p.type)).toEqual(["create_task"]);
      }
      expect((await api.get(`/api/v1/workflows/${wf.id}/runs`)).status(), role).toBe(expected(role, "workflow:read"));
      expect((await api.post(`/api/v1/workflows/${wf.id}/run_due`)).status(), role).toBe(
        expected(role, "workflow:launch"),
      );
      expect((await api.post(`/api/v1/workflows/${wf.id}/pause`)).status(), role).toBe(
        expected(role, "workflow:launch"),
      );
      expect((await api.post(`/api/v1/workflows/${wf.id}/archive`)).status(), role).toBe(
        expected(role, "workflow:update"),
      );
      expect((await api.delete(`/api/v1/workflows/${wf.id}`)).status(), role).toBe(expected(role, "workflow:delete"));
      await archive(wf.id);
    }
    const count = await (await apiAsRole("viewer")).post("/api/v1/workflows/enrollment_count", {
      data: { targetType: "contact", enrollmentFilters: { stage: ["new"] } },
    });
    expect(count.status()).toBe(200);
    expect(typeof (await count.json()).count).toBe("number");
    expect((await owner.get(`/api/v1/workflows/${crypto.randomUUID()}`)).status()).toBe(404);
  });

  test("block validation: unknown types, structure, traffic totals, delays, webhooks, triggers (422)", async () => {
    const owner = await apiAsRole("owner");
    const bad: [string, unknown][] = [
      ["unknown type", [{ id: "a", type: "launch_rocket", config: {} }]],
      [
        "duplicate ids",
        [
          { id: "a", type: "enrich", config: {} },
          { id: "a", type: "enrich", config: {} },
        ],
      ],
      [
        "block after a branch",
        [
          { id: "a", type: "branch_if", config: { match: "all", conditions: [] }, branches: { yes: [], no: [] } },
          { id: "b", type: "enrich", config: {} },
        ],
      ],
      [
        "missing branch paths",
        [{ id: "a", type: "branch_if", config: { match: "all", conditions: [] }, branches: { yes: [] } }],
      ],
      [
        "traffic not 100",
        [
          {
            id: "a",
            type: "split_traffic",
            config: {
              splits: [
                { key: "a", percent: 30 },
                { key: "b", percent: 30 },
              ],
            },
            branches: { a: [], b: [] },
          },
        ],
      ],
      ["delay too long", [{ id: "a", type: "delay", config: { amount: 400, unit: "days" } }]],
      [
        "exit not last",
        [
          { id: "a", type: "exit", config: {} },
          { id: "b", type: "enrich", config: {} },
        ],
      ],
      ["paths on an action", [{ id: "a", type: "enrich", config: {}, branches: { yes: [] } }]],
      ["http webhook", [{ id: "a", type: "webhook", config: { url: "http://example.com/hook" } }]],
      ["credentials in webhook", [{ id: "a", type: "webhook", config: { url: "https://user:pw@example.com/hook" } }]],
      ["ftp webhook", [{ id: "a", type: "webhook", config: { url: "ftp://example.com/hook" } }]],
      ["short secret", [{ id: "a", type: "webhook", config: { url: "https://example.com/hook", secret: "short" } }]],
      ["bad stage", [{ id: "a", type: "update_record", config: { field: "stage", value: "hot" } }]],
      ["unknown config key", [{ id: "a", type: "add_to_list", config: { listId: "x", extra: true } }]],
    ];
    if (!ALLOW_PRIVATE)
      bad.push(["private webhook", [{ id: "a", type: "webhook", config: { url: "https://10.0.0.5/hook" } }]]);
    for (const [label, blocks] of bad) {
      const res = await owner.post("/api/v1/workflows", { data: { blocks } });
      expect(res.status(), label).toBe(422);
    }
    expect((await owner.post("/api/v1/workflows", { data: { triggerEvent: "nope" } })).status()).toBe(422);
    expect((await owner.post("/api/v1/workflows", { data: { triggerEvent: "form_submitted" } })).status()).toBe(422);
    expect(
      (await owner.post("/api/v1/workflows", { data: { targetType: "deal", triggerEvent: "email_opened" } })).status(),
    ).toBe(422);
    expect(
      (
        await owner.post("/api/v1/workflows", {
          data: { triggerType: "schedule", schedule: { weekly: { days: ["mon"], time: "25:00" }, timezone: "UTC" } },
        })
      ).status(),
    ).toBe(422);
    expect(
      (
        await owner.post("/api/v1/workflows", {
          data: { schedule: { timezone: "Mars/Olympus", at: new Date().toISOString() } },
        })
      ).status(),
    ).toBe(422);
    expect(
      (await owner.post("/api/v1/workflows", { data: { enrollmentFilters: { listId: "not-ours" } } })).status(),
    ).toBe(422);

    // Drafts may be incomplete, but launching needs a trigger, blocks and complete settings.
    const draft = await create(owner, {
      name: uniq("Incomplete"),
      blocks: [{ id: "a", type: "add_to_list", config: {} }],
    });
    const launch = await owner.post(`/api/v1/workflows/${draft.id}/launch`);
    expect(launch.status()).toBe(422);
    const details = JSON.stringify(await launch.json());
    expect(details).toContain("Choose a trigger event.");
    expect(details).toContain("Choose a list.");
    const empty = await create(owner, { name: uniq("Empty"), triggerEvent: "contact_created" });
    expect((await owner.post(`/api/v1/workflows/${empty.id}/launch`)).status()).toBe(422);
    await archive(draft.id);
    await archive(empty.id);
  });

  test("webhook secrets are stored but never returned; blank secret keeps the stored one", async () => {
    const owner = await apiAsRole("owner");
    const secret = "s3cret-signing-key-123456";
    const wf = await create(owner, {
      blocks: [{ id: "hook", type: "webhook", config: { url: "https://example.com/hook", secret } }],
    });
    expect(wf.blocks[0].config).toMatchObject({ hasSecret: true });
    expect(JSON.stringify(wf)).not.toContain(secret);
    const updated = await owner.patch(`/api/v1/workflows/${wf.id}`, {
      data: {
        blocks: [{ id: "hook", type: "webhook", config: { url: "https://example.com/other", hasSecret: true } }],
      },
    });
    expect(updated.status(), await updated.text()).toBe(200);
    const after = (await updated.json()).workflow;
    expect(after.blocks[0].config).toMatchObject({ url: "https://example.com/other", hasSecret: true });
    expect(JSON.stringify(after)).not.toContain(secret);
    await archive(wf.id);
  });

  test("Globex isolation (404) and cross-site writes (403)", async () => {
    const owner = await apiAsRole("owner");
    const wf = await create(owner);
    const globex = await globexApi();
    expect((await globex.get(`/api/v1/workflows/${wf.id}`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/workflows/${wf.id}`, { data: { name: "x" } })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/workflows/${wf.id}`)).status()).toBe(404);
    for (const action of ["launch", "pause", "archive", "run_due"]) {
      expect((await globex.post(`/api/v1/workflows/${wf.id}/${action}`)).status(), action).toBe(404);
    }
    expect((await globex.post(`/api/v1/workflows/${wf.id}/test`, { data: { entityId: "x" } })).status()).toBe(404);
    expect((await globex.get(`/api/v1/workflows/${wf.id}/runs`)).status()).toBe(404);
    const list = (await (await globex.get("/api/v1/workflows")).json()).workflows as { id: string }[];
    expect(list.some((w) => w.id === wf.id)).toBe(false);
    // An Acme contact can't be dry-run from Acme's workflow by Globex, nor a Globex record by Acme.
    expect((await owner.post(`/api/v1/workflows/${wf.id}/test`, { data: { entityId: "missing" } })).status()).toBe(422);

    expect((await owner.post("/api/v1/workflows", { headers: EVIL_ORIGIN, data: {} })).status()).toBe(403);
    expect(
      (await owner.patch(`/api/v1/workflows/${wf.id}`, { headers: EVIL_ORIGIN, data: { name: "x" } })).status(),
    ).toBe(403);
    expect((await owner.post(`/api/v1/workflows/${wf.id}/launch`, { headers: EVIL_ORIGIN })).status()).toBe(403);
    expect((await owner.delete(`/api/v1/workflows/${wf.id}`, { headers: EVIL_ORIGIN })).status()).toBe(403);
    await archive(wf.id);
  });
});
