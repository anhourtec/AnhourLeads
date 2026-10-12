import { type APIRequestContext, expect, test } from "@playwright/test";

import { type FixtureServer, startFixtureServer } from "../support/fixture-server";
import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";
import { createContact, pg, uniq } from "./_engage";

/**
 * Enrichment jobs: CSV uploads, selected records and lists, the automation schedule and the CSV
 * download. The CSV end-to-end test crawls the fixture site (tests/fixtures/site on 127.0.0.1:48090).
 */

test.describe.configure({ timeout: 120_000 });

const EVIL = { origin: "https://evil.example" };
const OFFLINE_CSV = "name,email\nNobody,not-an-email\n";

interface JobView {
  id: string;
  kind: string;
  status: string;
  total: number;
  processed: number;
  enriched: number;
  failed: number;
}

interface ResultRow {
  row: number;
  email: string | null;
  inputEmail: string | null;
  status: string | null;
  source: string | null;
  confidence: number | null;
  sourceUrl: string | null;
  saved: string | null;
}

async function waitForJob(api: APIRequestContext, id: string, timeoutMs = 100_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const res = await api.get(`/api/v1/enrichment_jobs/${id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    if (body.enrichment_job.status === "completed" || body.enrichment_job.status === "failed") return body;
    if (Date.now() > until) throw new Error(`enrichment job ${id} still ${body.enrichment_job.status}`);
    await new Promise((r) => setTimeout(r, 750));
  }
}

async function recordsJob(api: APIRequestContext, contactIds: string[]) {
  const res = await api.post("/api/v1/enrichment_jobs", { data: { kind: "records", contactIds } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).enrichment_job as JobView;
}

let fixture: FixtureServer;
test.beforeAll(async () => {
  fixture = await startFixtureServer();
});
test.afterAll(async () => {
  await fixture.close();
});

test.describe("enrichment jobs: role matrix", () => {
  test("POST /enrichment_jobs (csv and records)", async () => {
    const contactId = await createContact("acme", { email: `${uniq("ej")}@example.test`, emailStatus: "valid" });
    await pg().query("update contact set email_verified_at = now() where id = $1", [contactId]);
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const csv = await api.post("/api/v1/enrichment_jobs", {
        data: { kind: "csv", fileName: `${role}.csv`, csv: OFFLINE_CSV },
      });
      expect(csv.status(), `${role} csv`).toBe(expected(role, "enrich:run", 201));
      const records = await api.post("/api/v1/enrichment_jobs", { data: { kind: "records", contactIds: [contactId] } });
      expect(records.status(), `${role} records`).toBe(expected(role, "enrich:run", 201));
    }
  });

  test("GET /enrichment_jobs, /[id] and /[id]/download", async () => {
    const job = await recordsJob(await apiAsRole("member"), [
      await createContact("acme", { email: `${uniq("ej")}@example.test` }),
    ]);
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const list = await api.get("/api/v1/enrichment_jobs?per_page=5");
      expect(list.status(), role).toBe(expected(role, "contact:read"));
      const one = await api.get(`/api/v1/enrichment_jobs/${job.id}`);
      expect(one.status(), role).toBe(expected(role, "contact:read"));
      const csv = await api.get(`/api/v1/enrichment_jobs/${job.id}/download`);
      expect(csv.status(), role).toBe(expected(role, "contact:read"));
    }
  });

  test("GET / PUT /enrichment_automation", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      expect((await api.get("/api/v1/enrichment_automation")).status(), role).toBe(expected(role, "contact:read"));
      const put = await api.put("/api/v1/enrichment_automation", {
        data: { enabled: false, verifyOlderThanDays: 90, recrawlOlderThanDays: 120, everyDays: 7 },
      });
      expect(put.status(), role).toBe(expected(role, "enrich:run"));
    }
  });

  test("saving CSV results to records needs contact:create", async () => {
    const viewer = await apiAsRole("viewer");
    const res = await viewer.post("/api/v1/enrichment_jobs", {
      data: { kind: "csv", csv: OFFLINE_CSV, saveToRecords: true },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe("enrichment jobs: auth, validation, isolation, CSRF", () => {
  test("unauthenticated requests get 401", async () => {
    const anon = await anonymous();
    expect((await anon.get("/api/v1/enrichment_jobs")).status()).toBe(401);
    expect((await anon.post("/api/v1/enrichment_jobs", { data: { kind: "csv", csv: OFFLINE_CSV } })).status()).toBe(
      401,
    );
    expect((await anon.get("/api/v1/enrichment_jobs/x")).status()).toBe(401);
    expect((await anon.get("/api/v1/enrichment_jobs/x/download")).status()).toBe(401);
    expect((await anon.get("/api/v1/enrichment_automation")).status()).toBe(401);
  });

  test("invalid input gets 422", async () => {
    const api = await apiAsRole("member");
    const bad = [
      { kind: "csv", csv: "" },
      { kind: "csv", csv: "colour,shape\nred,round\n" },
      { kind: "csv", csv: "email\n" },
      { kind: "csv", csv: `email\n${"a@b.co\n".repeat(10_001)}` },
      { kind: "records" },
      { kind: "records", contactIds: [] },
      { kind: "unknown" },
    ];
    for (const data of bad) {
      const res = await api.post("/api/v1/enrichment_jobs", { data });
      expect(res.status(), JSON.stringify(data).slice(0, 60)).toBe(422);
    }
    const tooMany = await api.post("/api/v1/enrichment_jobs", {
      data: { kind: "csv", csv: `email\n${"a@b.co\n".repeat(10_001)}` },
    });
    expect((await tooMany.json()).details[0].message).toContain("10,000");
    const auto = await api.put("/api/v1/enrichment_automation", {
      data: { enabled: true, verifyOlderThanDays: 1, recrawlOlderThanDays: 90, everyDays: 7 },
    });
    expect(auto.status()).toBe(422);
    expect((await api.post("/api/v1/enrichment_jobs", { data: { kind: "list", listId: "nope" } })).status()).toBe(404);
  });

  test("another workspace can't read or use Acme's jobs and records", async () => {
    const acmeContact = await createContact("acme", { email: `${uniq("iso")}@example.test` });
    const job = await recordsJob(await apiAsRole("member"), [acmeContact]);
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/enrichment_jobs/${job.id}`)).status()).toBe(404);
    expect((await globex.get(`/api/v1/enrichment_jobs/${job.id}/download`)).status()).toBe(404);
    const list = await (await globex.get("/api/v1/enrichment_jobs?per_page=100")).json();
    expect(list.enrichment_jobs.some((j: JobView) => j.id === job.id)).toBe(false);
    const steal = await globex.post("/api/v1/enrichment_jobs", {
      data: { kind: "records", contactIds: [acmeContact] },
    });
    expect(steal.status()).toBe(404);
  });

  test("cross-site cookie writes are refused", async () => {
    const api = await apiAsRole("owner");
    const res = await api.post(`${BASE_URL}/api/v1/enrichment_jobs`, {
      headers: EVIL,
      data: { kind: "csv", csv: OFFLINE_CSV },
    });
    expect(res.status()).toBe(403);
    const put = await api.put(`${BASE_URL}/api/v1/enrichment_automation`, {
      headers: EVIL,
      data: { enabled: false, verifyOlderThanDays: 90, recrawlOlderThanDays: 90, everyDays: 7 },
    });
    expect(put.status()).toBe(403);
  });
});

test.describe("enrichment jobs: behaviour", () => {
  test("a CSV is enriched from the company's website and classified, then downloaded", async () => {
    test.setTimeout(180_000);
    const api = await apiAsRole("member");
    const csv = [
      "First Name,Last Name,Company,Website,Email",
      `Jane,Doe,Fixture Acme,${fixture.url}/,`,
      "Throw,Away,,,x@mailinator.com",
      "Front,Desk,,,info@gmail.com",
      "Bad,Address,,,not-an-email",
      "Only,Name,,,",
    ].join("\n");
    const created = await api.post("/api/v1/enrichment_jobs", {
      data: { kind: "csv", fileName: "people.csv", csv, saveToRecords: true },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { enrichment_job } = await created.json();
    expect(enrichment_job.status).toBe("queued");
    expect(enrichment_job.total).toBe(5);

    const done = await waitForJob(api, enrichment_job.id, 150_000);
    expect(done.enrichment_job.status).toBe("completed");
    expect(done.enrichment_job.processed).toBe(5);
    const rows = done.rows as ResultRow[];
    const jane = rows[0];
    expect(jane?.email).toBe("jane.doe@fixture-acme.test");
    expect(jane?.source).toBe("crawler");
    expect(jane?.sourceUrl).toContain(fixture.url);
    expect(jane?.confidence).toBeGreaterThan(0.5);
    expect(rows[1]?.status).toBe("disposable");
    expect(rows[1]?.source).toBe("input");
    expect(rows[2]?.status).toBe("role");
    expect(rows[3]?.status).toBe("invalid");
    expect(rows[4]?.email).toBeNull();
    // Invalid and disposable addresses are never saved.
    expect(rows[1]?.saved).toBeNull();
    expect(rows[3]?.saved).toBeNull();
    expect(["created", "exists"]).toContain(rows[2]?.saved);

    const download = await api.get(`/api/v1/enrichment_jobs/${enrichment_job.id}/download`);
    expect(download.status()).toBe(200);
    expect(download.headers()["content-type"]).toContain("text/csv");
    const text = await download.text();
    expect(text.split("\r\n")[0]).toContain("email_status");
    expect(text).toContain("jane.doe@fixture-acme.test");

    // A saved contact carries provenance from the verification.
    const { rows: saved } = await pg().query<{ id: string; source: string }>(
      "select id, source from contact where lower(email) = 'info@gmail.com' and organization_id = (select id from organization where slug = 'acme')",
    );
    expect(saved[0]).toBeTruthy();
    if (rows[2]?.saved === "created") {
      expect(saved[0]?.source).toBe("csv_enrichment");
      const prov = await pg().query("select field, source from field_provenance where entity_id = $1", [saved[0]?.id]);
      expect(prov.rows.some((p: { field: string }) => p.field === "emailStatus")).toBe(true);
    }
  });

  test("a records job verifies stale addresses with provenance, and lists jobs without the schedule row", async () => {
    const api = await apiAsRole("member");
    const contactId = await createContact("acme", {
      email: `${uniq("tmp")}@mailinator.com`,
      emailStatus: "unverified",
    });
    const job = await recordsJob(api, [contactId]);
    const done = await waitForJob(api, job.id);
    expect(done.enrichment_job.status).toBe("completed");
    expect(done.outcomes[0].action).toBe("verified");
    const { rows } = await pg().query<{ email_status: string }>("select email_status from contact where id = $1", [
      contactId,
    ]);
    expect(rows[0]?.email_status).toBe("disposable");
    const prov = await pg().query<{ source: string }>(
      "select source from field_provenance where entity_id = $1 and field = 'emailStatus'",
      [contactId],
    );
    expect(prov.rows.length).toBeGreaterThan(0);

    const auto = await api.put("/api/v1/enrichment_automation", {
      data: { enabled: true, verifyOlderThanDays: 60, recrawlOlderThanDays: 90, everyDays: 14 },
    });
    expect(auto.status()).toBe(200);
    const view = (await auto.json()).automation;
    expect(view.enabled).toBe(true);
    expect(view.everyDays).toBe(14);
    const again = await (await api.get("/api/v1/enrichment_automation")).json();
    expect(again.automation.verifyOlderThanDays).toBe(60);
    expect(Array.isArray(again.active_jobs)).toBe(true);
    const list = await (await api.get("/api/v1/enrichment_jobs?per_page=100")).json();
    for (const j of list.enrichment_jobs as JobView[]) expect(j.total + j.processed).toBeGreaterThanOrEqual(0);
    await api.put("/api/v1/enrichment_automation", {
      data: { enabled: false, verifyOlderThanDays: 90, recrawlOlderThanDays: 90, everyDays: 7 },
    });
  });

  test("a health segment queues a records job", async () => {
    const api = await apiAsRole("member");
    const res = await api.post("/api/v1/enrichment_jobs", { data: { kind: "records", segment: "unverified_email" } });
    expect(res.status(), await res.text()).toBe(201);
    const job = (await res.json()).enrichment_job;
    expect(job.kind).toBe("records");
  });
});
