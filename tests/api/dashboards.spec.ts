import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";
import { EVIL_ORIGIN, uniq } from "./admin-helpers";

/** Analytics dashboards: system dashboards, custom CRUD, widget validation, matrix and isolation. */

const SYSTEM = [
  "Data enrichment & quality",
  "Engagement performance",
  "Sequence performance",
  "Pipeline",
  "Sales manager command center",
];

interface Dashboard {
  id: string;
  name: string;
  kind: string;
  starred: boolean;
  shared: boolean;
  widgets: Array<{ id: string; type: string; metric: string; groupBy: string; range: string; title: string }>;
}

async function create(name = uniq("Dash"), extra: Record<string, unknown> = {}): Promise<Dashboard> {
  const api = await apiAsRole("manager");
  const res = await api.post("/api/v1/dashboards", { data: { name, ...extra } });
  expect(res.status()).toBe(201);
  return (await res.json()).dashboard;
}

test.describe("dashboards", () => {
  test("system dashboards exist once per workspace and carry data", async () => {
    const api = await apiAsRole("viewer");
    const [a, b] = await Promise.all([api.get("/api/v1/dashboards"), api.get("/api/v1/dashboards")]);
    expect(a.status()).toBe(200);
    expect(b.status()).toBe(200);
    const list = ((await (await api.get("/api/v1/dashboards")).json()).dashboards as Dashboard[]).filter(
      (d) => d.kind === "system",
    );
    for (const name of SYSTEM)
      expect(
        list.filter((d) => d.name === name),
        name,
      ).toHaveLength(1);

    const engagement = list.find((d) => d.name === "Engagement performance");
    const detail = await (await api.get(`/api/v1/dashboards/${engagement?.id}`)).json();
    expect(detail.dashboard.widgets.length).toBeGreaterThan(3);
    for (const widget of detail.dashboard.widgets) {
      const data = detail.data[widget.id];
      expect(data.error, widget.title).toBeNull();
      expect(Array.isArray(data.rows)).toBe(true);
    }
  });

  for (const role of ROLES) {
    test(`${role}: list, read and write per the matrix`, async () => {
      const api = await apiAsRole(role);
      expect((await api.get("/api/v1/dashboards")).status()).toBe(expected(role, "analytics:read"));
      const res = await api.post("/api/v1/dashboards", { data: { name: uniq(`${role} dash`) } });
      expect(res.status()).toBe(expected(role, "dashboard:manage", 201));
      const target = await create();
      expect((await api.get(`/api/v1/dashboards/${target.id}`)).status()).toBe(expected(role, "analytics:read"));
      expect((await api.patch(`/api/v1/dashboards/${target.id}`, { data: { starred: true } })).status()).toBe(
        expected(role, "dashboard:manage"),
      );
      expect((await api.delete(`/api/v1/dashboards/${target.id}`)).status()).toBe(expected(role, "dashboard:manage"));
    });
  }

  test("add widgets, star, rename and delete a custom dashboard", async () => {
    const api = await apiAsRole("admin");
    const dash = await create();
    const widgets = [
      { type: "kpi", metric: "emails_sent", groupBy: "none", range: "30d" },
      { type: "line", metric: "emails_sent", metrics: ["emails_replied"], groupBy: "day", range: "7d", title: "Daily" },
      { type: "table", metric: "tasks_completed", groupBy: "rep", range: "this_month" },
    ];
    const patched = await api.patch(`/api/v1/dashboards/${dash.id}`, {
      data: { widgets, starred: true, name: `${dash.name} renamed` },
    });
    expect(patched.status()).toBe(200);
    const body = (await patched.json()).dashboard as Dashboard;
    expect(body.starred).toBe(true);
    expect(body.name).toContain("renamed");
    expect(body.widgets).toHaveLength(3);
    expect(body.widgets[0].title).toBe("Emails sent");
    for (const w of body.widgets) expect(w.id).toBeTruthy();

    const detail = await (await api.get(`/api/v1/dashboards/${dash.id}`)).json();
    const daily = detail.data[body.widgets[1].id];
    expect(daily.series.map((s: { metric: string }) => s.metric)).toEqual(["emails_sent", "emails_replied"]);
    expect(daily.rows).toHaveLength(7);

    const audit = await (await api.get(`/api/v1/audit_logs?entityId=${dash.id}`)).json();
    const actions = audit.audit_logs.map((l: { action: string }) => l.action);
    expect(actions).toEqual(expect.arrayContaining(["dashboard.create", "dashboard.update"]));

    expect((await api.delete(`/api/v1/dashboards/${dash.id}`)).status()).toBe(200);
    expect((await api.get(`/api/v1/dashboards/${dash.id}`)).status()).toBe(404);
  });

  test("validation → 422", async () => {
    const api = await apiAsRole("manager");
    expect((await api.post("/api/v1/dashboards", { data: { name: "" } })).status()).toBe(422);
    expect((await api.post("/api/v1/dashboards", { data: { name: "Pipeline" } })).status()).toBe(422);
    const dash = await create();
    for (const widget of [
      { type: "kpi", metric: "made_up", groupBy: "none" },
      { type: "pie", metric: "emails_sent", groupBy: "none" },
      { type: "line", metric: "emails_sent", groupBy: "none" },
      { type: "bar", metric: "calls_logged", groupBy: "sequence" },
      { type: "kpi", metric: "emails_sent", groupBy: "none", range: "forever" },
    ]) {
      const res = await api.patch(`/api/v1/dashboards/${dash.id}`, { data: { widgets: [widget] } });
      expect(res.status(), JSON.stringify(widget)).toBe(422);
    }
  });

  test("system dashboards can be starred but not renamed, edited or deleted", async () => {
    const api = await apiAsRole("owner");
    const list = (await (await api.get("/api/v1/dashboards")).json()).dashboards as Dashboard[];
    const pipeline = list.find((d) => d.kind === "system" && d.name === "Pipeline");
    expect(pipeline).toBeTruthy();
    const id = pipeline?.id;
    expect((await api.patch(`/api/v1/dashboards/${id}`, { data: { name: "Mine now" } })).status()).toBe(422);
    expect((await api.patch(`/api/v1/dashboards/${id}`, { data: { widgets: [] } })).status()).toBe(422);
    expect((await api.delete(`/api/v1/dashboards/${id}`)).status()).toBe(422);
    const starred = await api.patch(`/api/v1/dashboards/${id}`, { data: { starred: !pipeline?.starred } });
    expect(starred.status()).toBe(200);
    await api.patch(`/api/v1/dashboards/${id}`, { data: { starred: pipeline?.starred ?? false } });
  });

  test("private dashboards are only visible to their owner", async () => {
    const dash = await create(uniq("Private"), { shared: false });
    const admin = await apiAsRole("admin");
    expect((await admin.get(`/api/v1/dashboards/${dash.id}`)).status()).toBe(404);
    const list = (await (await admin.get("/api/v1/dashboards")).json()).dashboards as Dashboard[];
    expect(list.some((d) => d.id === dash.id)).toBe(false);
    const manager = await apiAsRole("manager");
    expect((await manager.get(`/api/v1/dashboards/${dash.id}`)).status()).toBe(200);
  });

  test("unauthenticated → 401", async () => {
    const anon = await anonymous();
    expect((await anon.get("/api/v1/dashboards")).status()).toBe(401);
    expect((await anon.post("/api/v1/dashboards", { data: { name: "x" } })).status()).toBe(401);
  });

  test("Globex can't read or change Acme dashboards", async () => {
    const dash = await create();
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/dashboards/${dash.id}`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/dashboards/${dash.id}`, { data: { starred: true } })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/dashboards/${dash.id}`)).status()).toBe(404);
    const list = (await (await globex.get("/api/v1/dashboards")).json()).dashboards as Dashboard[];
    expect(list.some((d) => d.id === dash.id)).toBe(false);
    for (const name of SYSTEM) expect(list.filter((d) => d.name === name)).toHaveLength(1);
  });

  test("cross-site cookie writes are refused", async () => {
    const owner = await apiAsRole("owner");
    expect(
      (await owner.post(`${BASE_URL}/api/v1/dashboards`, { headers: EVIL_ORIGIN, data: { name: "x" } })).status(),
    ).toBe(403);
    const dash = await create();
    expect(
      (await owner.patch(`/api/v1/dashboards/${dash.id}`, { headers: EVIL_ORIGIN, data: { starred: true } })).status(),
    ).toBe(403);
    expect((await owner.delete(`/api/v1/dashboards/${dash.id}`, { headers: EVIL_ORIGIN })).status()).toBe(403);
  });
});
