import { type APIRequestContext, expect, test } from "@playwright/test";

import { parseNaturalLanguage } from "../../src/lib/search/nl-parser";
import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { orgId, pg, uniq } from "./_engage";
import { randomUUID } from "node:crypto";

test.describe.configure({ timeout: 120_000 });

/* -------------------------------------------------------------------------- */
/* Fixtures: direct inserts so every test owns its data                        */
/* -------------------------------------------------------------------------- */

async function userId(email: string): Promise<string> {
  const { rows } = await pg().query<{ id: string }>('select id from "user" where email = $1', [email]);
  return rows[0].id;
}

interface CompanyFields {
  name: string;
  industry?: string | null;
  employeeCount?: number | null;
  keywords?: string[];
  technologies?: string[];
  country?: string | null;
  city?: string | null;
  foundedYear?: number | null;
  annualRevenue?: number | null;
  ownerId?: string | null;
}

async function company(f: CompanyFields, slug: "acme" | "globex" = "acme"): Promise<string> {
  const id = randomUUID();
  await pg().query(
    `insert into company (id, organization_id, name, domain, industry, employee_count, keywords, technologies, country, city, founded_year, annual_revenue, owner_id, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'test')`,
    [
      id,
      await orgId(slug),
      f.name,
      `${id.slice(0, 8)}.search-parity.example`,
      f.industry ?? null,
      f.employeeCount ?? null,
      f.keywords ?? [],
      f.technologies ?? [],
      f.country ?? null,
      f.city ?? null,
      f.foundedYear ?? null,
      f.annualRevenue ?? null,
      f.ownerId ?? null,
    ],
  );
  return id;
}

interface PersonFields {
  companyId?: string | null;
  firstName?: string;
  lastName?: string;
  title?: string | null;
  seniority?: string | null;
  department?: string | null;
  emailStatus?: string;
  stage?: string;
  country?: string | null;
  city?: string | null;
  timezone?: string | null;
  ownerId?: string | null;
  source?: string;
  createdAt?: string;
}

async function person(f: PersonFields, slug: "acme" | "globex" = "acme"): Promise<string> {
  const id = randomUUID();
  await pg().query(
    `insert into contact (id, organization_id, company_id, first_name, last_name, title, seniority, department, email, email_status, stage, country, city, timezone, owner_id, source, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,coalesce($17::timestamptz, now()))`,
    [
      id,
      await orgId(slug),
      f.companyId ?? null,
      f.firstName ?? "Parity",
      f.lastName ?? id.slice(0, 6),
      f.title ?? null,
      f.seniority ?? null,
      f.department ?? null,
      `${id}@search-parity.example`,
      f.emailStatus ?? "unverified",
      f.stage ?? "new",
      f.country ?? null,
      f.city ?? null,
      f.timezone ?? null,
      f.ownerId ?? null,
      f.source ?? "test",
      f.createdAt ?? null,
    ],
  );
  return id;
}

async function people(api: APIRequestContext, body: Record<string, unknown>) {
  const res = await api.post("/api/v1/mixed_people/search", { data: { per_page: 100, ...body } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as {
    people: { id: string }[];
    pagination: { total_entries: number };
    segment_counts?: { total: number; net_new: number; saved: number };
    facets?: Record<string, { value: string; count: number }[]>;
  };
}

async function companies(api: APIRequestContext, body: Record<string, unknown>) {
  const res = await api.post("/api/v1/mixed_companies/search", { data: { per_page: 100, ...body } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as {
    organizations: { id: string }[];
    pagination: { total_entries: number };
    segment_counts?: { total: number; net_new: number; saved: number };
    facets?: Record<string, { value: string; count: number }[]>;
  };
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();
const facet = (f: Record<string, { value: string; count: number }[]> | undefined, name: string) =>
  Object.fromEntries((f?.[name] ?? []).map((v) => [v.value, v.count]));

/* -------------------------------------------------------------------------- */
/* Natural-language parser                                                    */
/* -------------------------------------------------------------------------- */

test.describe("natural-language search parser", () => {
  test("turns sentences into filters", () => {
    expect(parseNaturalLanguage("VP sales in Canada at software companies with 50-200 employees")).toEqual({
      employeesMin: "50",
      employeesMax: "200",
      industry: ["software"],
      location: ["Canada"],
      titles: ["VP sales"],
    });
    expect(parseNaturalLanguage("Who are the leading Software Engineers in San Francisco?")).toEqual({
      location: ["San Francisco"],
      titles: ["Software Engineer"],
    });
    expect(parseNaturalLanguage("founders in the UK with verified emails")).toEqual({
      emailStatus: ["valid"],
      location: ["United Kingdom"],
      titles: ["founder"],
    });
    expect(parseNaturalLanguage("marketing directors at Acme")).toEqual({
      company: ["Acme"],
      titles: ["marketing director"],
    });
    expect(parseNaturalLanguage("CTOs at fintech or saas companies with over 500 employees")).toEqual({
      employeesMin: "501",
      industry: ["fintech", "saas"],
      titles: ["CTO"],
    });
    expect(parseNaturalLanguage("head of operations in Germany with fewer than 50 employees")).toEqual({
      employeesMax: "49",
      location: ["Germany"],
      titles: ["head of operations"],
    });
    expect(parseNaturalLanguage("people in healthcare")).toEqual({ industry: ["healthcare"] });
    expect(parseNaturalLanguage("sales managers with 1000+ employees")).toEqual({
      employeesMin: "1000",
      titles: ["sales manager"],
    });
  });

  test("uses the workspace's own vocabulary and aliases", () => {
    expect(
      parseNaturalLanguage("account executives in Springfield at widgets companies", {
        locations: ["Springfield"],
        industries: ["Widgets"],
      }),
    ).toEqual({ location: ["Springfield"], industry: ["Widgets"], titles: ["account executive"] });
    expect(parseNaturalLanguage("engineers based in the usa")).toEqual({
      location: ["United States"],
      titles: ["engineer"],
    });
    expect(parseNaturalLanguage("")).toEqual({});
  });
});

/* -------------------------------------------------------------------------- */
/* Role matrix, auth, CSRF, validation, isolation                              */
/* -------------------------------------------------------------------------- */

test.describe("search endpoints: role matrix", () => {
  test("every search endpoint for every role", async () => {
    const accountId = await company({ name: uniq("Matrix co") });
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const checks: [string, Promise<{ status(): number }>, number][] = [
        [
          "people search",
          api.post("/api/v1/mixed_people/search", { data: { includeCounts: true } }),
          expected(role, "search:run"),
        ],
        [
          "company search",
          api.post("/api/v1/mixed_companies/search", { data: { includeCounts: true } }),
          expected(role, "search:run"),
        ],
        ["people ids", api.post("/api/v1/mixed_people/ids", { data: { limit: 5 } }), expected(role, "search:run")],
        ["company ids", api.post("/api/v1/mixed_companies/ids", { data: { limit: 5 } }), expected(role, "search:run")],
        ["people values", api.get("/api/v1/mixed_people/filter_values?field=titles"), expected(role, "search:run")],
        [
          "company values",
          api.get("/api/v1/mixed_companies/filter_values?field=industry"),
          expected(role, "search:run"),
        ],
        ["insights", api.get(`/api/v1/accounts/${accountId}/insights`), expected(role, "company:read")],
        [
          "contact export",
          api.post("/api/v1/contacts/export", { data: { ids: [randomUUID()] } }),
          expected(role, "contact:export"),
        ],
        [
          "account export",
          api.post("/api/v1/accounts/export", { data: { ids: [accountId] } }),
          expected(role, "company:export"),
        ],
      ];
      for (const [name, pending, want] of checks) expect((await pending).status(), `${role} ${name}`).toBe(want);
    }
  });

  test("anonymous requests get 401", async () => {
    const api = await anonymous();
    expect((await api.post("/api/v1/mixed_people/search", { data: {} })).status()).toBe(401);
    expect((await api.post("/api/v1/mixed_companies/ids", { data: {} })).status()).toBe(401);
    expect((await api.get("/api/v1/mixed_people/filter_values?field=titles")).status()).toBe(401);
    expect((await api.get(`/api/v1/accounts/${randomUUID()}/insights`)).status()).toBe(401);
    expect((await api.post("/api/v1/contacts/export", { data: {} })).status()).toBe(401);
  });

  test("cookie POSTs from another site are refused", async () => {
    const api = await apiAsRole("owner");
    const evil = { origin: "https://evil.example" };
    expect((await api.post("/api/v1/mixed_people/search", { data: {}, headers: evil })).status()).toBe(403);
    expect((await api.post("/api/v1/mixed_people/ids", { data: {}, headers: evil })).status()).toBe(403);
    expect((await api.post("/api/v1/accounts/export", { data: {}, headers: evil })).status()).toBe(403);
  });

  test("bad filters get 422", async () => {
    const api = await apiAsRole("member");
    const bad: [string, Record<string, unknown>][] = [
      ["/api/v1/mixed_people/search", { emailStatus: ["nope"] }],
      ["/api/v1/mixed_people/search", { employeeRanges: ["7-9"] }],
      ["/api/v1/mixed_people/search", { emailOpened: "maybe" }],
      ["/api/v1/mixed_people/search", { lastActivityFrom: "not a date" }],
      ["/api/v1/mixed_companies/search", { stage: ["nope"] }],
      ["/api/v1/mixed_companies/search", { foundedMin: 99 }],
      ["/api/v1/mixed_people/ids", { limit: 0 }],
      ["/api/v1/mixed_people/ids", { limit: 20_000 }],
    ];
    for (const [path, data] of bad) {
      const res = await api.post(path, { data });
      expect(res.status(), `${path} ${JSON.stringify(data)}`).toBe(422);
    }
    expect((await api.get("/api/v1/mixed_people/filter_values?field=passwords")).status()).toBe(422);
  });

  test("Globex never sees Acme records and gets 404 on Acme ids", async () => {
    const marker = uniq("Isolated co");
    const acmeCompany = await company({ name: marker, industry: "Isolation" });
    await person({ companyId: acmeCompany, title: "Isolated title" });
    const list = await (await apiAsRole("owner")).post("/api/v1/labels", {
      data: { name: uniq("iso"), entityType: "contact" },
    });
    const listId = (await list.json()).label.id as string;
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await people(globex, { company: [marker] })).pagination.total_entries).toBe(0);
    expect((await companies(globex, { company: [marker] })).pagination.total_entries).toBe(0);
    const values = await (await globex.get(`/api/v1/mixed_companies/filter_values?field=company&q=${marker}`)).json();
    expect(values.values).toEqual([]);
    expect((await globex.get(`/api/v1/accounts/${acmeCompany}/insights`)).status()).toBe(404);
    expect((await globex.post("/api/v1/mixed_people/search", { data: { listId: [listId] } })).status()).toBe(404);
    const exported = await globex.post("/api/v1/accounts/export", { data: { ids: [acmeCompany] } });
    expect(exported.status()).toBe(200);
    expect(await exported.text()).not.toContain(marker);
    const globexIds = await (await globex.post("/api/v1/mixed_people/ids", { data: { company: [marker] } })).json();
    expect(globexIds.ids).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Counts, facets and filters on data the test creates                        */
/* -------------------------------------------------------------------------- */

test.describe("people search behaviour", () => {
  test("Total / Net new / Saved and facet counts", async () => {
    const owner = await apiAsRole("owner");
    const ownerId = await userId(ACME.owner);
    const memberId = await userId(ACME.member);
    const marker = uniq("Facet co");
    const co = await company({ name: marker, industry: "Facetry", employeeCount: 40 });
    const a = await person({ companyId: co, seniority: "vp", emailStatus: "valid", ownerId });
    const b = await person({ companyId: co, seniority: "vp", emailStatus: "invalid", ownerId: memberId });
    const c = await person({ companyId: co, seniority: "director", emailStatus: "valid", ownerId });

    let res = await people(owner, { company: [marker], includeCounts: true });
    expect(res.segment_counts).toEqual({ total: 3, net_new: 3, saved: 2 });
    expect(facet(res.facets, "seniority")).toEqual({ vp: 2, director: 1 });
    expect(facet(res.facets, "emailStatus")).toEqual({ valid: 2, invalid: 1 });
    expect(facet(res.facets, "employeeRanges")).toEqual({ "21-50": 3 });

    // A facet ignores its own filter; the others follow it.
    res = await people(owner, { company: [marker], seniority: ["vp"], includeCounts: true });
    expect(res.pagination.total_entries).toBe(2);
    expect(facet(res.facets, "seniority")).toEqual({ vp: 2, director: 1 });
    expect(facet(res.facets, "emailStatus")).toEqual({ valid: 1, invalid: 1 });

    // Net new drops when a person joins a list or gets a deal.
    const list = await owner.post("/api/v1/labels", { data: { name: uniq("nn"), entityType: "contact" } });
    const listId = (await list.json()).label.id as string;
    expect((await owner.post("/api/v1/labels/add_entity_ids", { data: { listId, entityIds: [a] } })).status()).toBe(
      200,
    );
    await pg().query("insert into deal (id, organization_id, name, contact_id) values ($1, $2, 'Parity deal', $3)", [
      randomUUID(),
      await orgId("acme"),
      b,
    ]);
    res = await people(owner, { company: [marker], includeCounts: true });
    expect(res.segment_counts).toEqual({ total: 3, net_new: 1, saved: 2 });
    expect(ids((await people(owner, { company: [marker], segment: "net_new" })).people)).toEqual([c]);
    expect(ids((await people(owner, { company: [marker], segment: "saved" })).people)).toEqual([a, c].sort());

    // "Saved" is per user.
    const asMember = await people(await apiAsRole("member"), { company: [marker], includeCounts: true });
    expect(asMember.segment_counts?.saved).toBe(1);
  });

  test("include / exclude combinations", async () => {
    const api = await apiAsRole("member");
    const marker = uniq("Combo");
    const soft = await company({
      name: `${marker} Soft`,
      industry: "Software",
      employeeCount: 120,
      keywords: ["payments", "billing"],
      technologies: ["HubSpot"],
      country: "Canada",
      foundedYear: 2015,
      annualRevenue: 5_000_000,
    });
    const hard = await company({
      name: `${marker} Hard`,
      industry: "Hardware",
      employeeCount: null,
      keywords: ["chips"],
      country: "Germany",
      foundedYear: 1990,
    });
    const vp = await person({
      companyId: soft,
      title: "VP of Sales",
      country: "Canada",
      city: "Toronto",
      timezone: "America/Toronto",
      department: "Sales",
    });
    const head = await person({ companyId: soft, title: "Head of Sales Operations", country: "United States" });
    const eng = await person({ companyId: hard, title: "Engineering Manager", country: "Germany", source: "api" });
    const base = { company: [marker] };

    expect(ids((await people(api, { ...base, titles: ["vp sales"] })).people)).toEqual([vp]);
    expect(ids((await people(api, { ...base, titles: ["vp sales"], similarTitles: false })).people)).toEqual([]);
    expect(ids((await people(api, { ...base, titles: ['"VP of Sales"'] })).people)).toEqual([vp]);
    expect(ids((await people(api, { ...base, titles: ["sales"], titlesExclude: ["operations"] })).people)).toEqual([
      vp,
    ]);
    expect(ids((await people(api, { ...base, location: ["toronto"] })).people)).toEqual([vp]);
    expect(ids((await people(api, { ...base, locationExclude: ["Canada"] })).people)).toEqual([head, eng].sort());
    expect(ids((await people(api, { ...base, timezone: ["America/Toronto"] })).people)).toEqual([vp]);
    expect(ids((await people(api, { ...base, department: ["sales"] })).people)).toEqual([vp]);
    expect(ids((await people(api, { ...base, industry: ["software"] })).people)).toEqual([vp, head].sort());
    expect(ids((await people(api, { ...base, industryExclude: ["software"] })).people)).toEqual([eng]);
    expect(ids((await people(api, { ...base, keywords: ["pay"] })).people)).toEqual([vp, head].sort());
    expect(ids((await people(api, { ...base, keywordsExclude: ["chips"] })).people)).toEqual([vp, head].sort());
    expect(ids((await people(api, { ...base, technologies: ["hubspot"] })).people)).toEqual([vp, head].sort());
    expect(ids((await people(api, { ...base, employeeRanges: ["101-200"] })).people)).toEqual([vp, head].sort());
    expect(ids((await people(api, { ...base, employeesUnknown: true })).people)).toEqual([eng]);
    expect(ids((await people(api, { ...base, employeeRanges: ["101-200"], employeesUnknown: true })).people)).toEqual(
      [vp, head, eng].sort(),
    );
    expect(ids((await people(api, { ...base, foundedMax: 2000 })).people)).toEqual([eng]);
    expect(ids((await people(api, { ...base, revenueMin: 1_000_000 })).people)).toEqual([vp, head].sort());
    expect(ids((await people(api, { ...base, companyExclude: [`${marker} Hard`] })).people)).toEqual([vp, head].sort());
    expect(ids((await people(api, { ...base, companyLocation: ["germany"] })).people)).toEqual([eng]);
    expect(ids((await people(api, { ...base, source: ["api"] })).people)).toEqual([eng]);
    expect(ids((await people(api, { ...base, ids: [vp, eng] })).people)).toEqual([vp, eng].sort());
  });

  test("engagement, sequence, dates, owner, import, custom field and persona filters", async () => {
    const owner = await apiAsRole("owner");
    const org = await orgId("acme");
    const ownerId = await userId(ACME.owner);
    const marker = uniq("Engage co");
    const co = await company({ name: marker });
    const opened = await person({ companyId: co, ownerId, createdAt: "2020-01-15T10:00:00Z" });
    const replied = await person({ companyId: co, title: "Chief Widget Officer" });
    const quiet = await person({ companyId: co });
    const base = { company: [marker] };

    await pg().query(
      "insert into activity (id, organization_id, contact_id, type, summary, occurred_at) values ($1, $2, $3, 'email_opened', 'Opened', '2026-01-10T00:00:00Z')",
      [randomUUID(), org, opened],
    );
    const seq = await owner.post("/api/v1/emailer_campaigns", { data: { name: uniq("Parity seq") } });
    expect(seq.status(), await seq.text()).toBe(201);
    const sequenceId = (await seq.json()).emailer_campaign.id as string;
    await pg().query(
      "insert into enrollment (id, organization_id, sequence_id, contact_id, status) values ($1, $2, $3, $4, 'replied')",
      [randomUUID(), org, sequenceId, replied],
    );

    expect(ids((await people(owner, { ...base, emailOpened: "yes" })).people)).toEqual([opened]);
    expect(ids((await people(owner, { ...base, emailOpened: "no" })).people)).toEqual([replied, quiet].sort());
    expect(ids((await people(owner, { ...base, emailReplied: "yes" })).people)).toEqual([replied]);
    expect(ids((await people(owner, { ...base, sequenceId: [sequenceId] })).people)).toEqual([replied]);
    expect(ids((await people(owner, { ...base, sequenceId: ["any"] })).people)).toEqual([replied]);
    expect(ids((await people(owner, { ...base, sequenceExclude: [sequenceId] })).people)).toEqual(
      [opened, quiet].sort(),
    );
    expect(
      ids((await people(owner, { ...base, lastActivityFrom: "2026-01-01", lastActivityTo: "2026-01-31" })).people),
    ).toEqual([opened]);
    expect(ids((await people(owner, { ...base, createdTo: "2020-12-31" })).people)).toEqual([opened]);
    expect(ids((await people(owner, { ...base, ownerId: ["me"] })).people)).toEqual([opened]);
    expect(ids((await people(owner, { ...base, ownerId: ["none"] })).people)).toEqual([replied, quiet].sort());

    // CSV import batch.
    const csvMarker = uniq("csv");
    const imported = await owner.post("/api/v1/contacts/import", {
      data: { csv: `email,first name,company\n${csvMarker}@search-parity.example,Imported,${marker}\n` },
    });
    expect(imported.status(), await imported.text()).toBe(200);
    const batchId = (await imported.json()).batchId as string | undefined;
    if (batchId) {
      const byImport = await people(owner, { importId: [batchId] });
      expect(byImport.pagination.total_entries).toBe(1);
    }

    // Custom field.
    const key = `tier_${Date.now().toString(36)}`;
    const field = await owner.post("/api/v1/custom_fields", {
      data: { entityType: "contact", label: `Tier ${key}`, key, type: "picklist", options: ["Gold", "Silver"] },
    });
    expect(field.status(), await field.text()).toBe(201);
    const patched = await owner.patch(`/api/v1/contacts/${quiet}`, { data: { customFields: { [key]: "gold" } } });
    expect(patched.status(), await patched.text()).toBe(200);
    expect(ids((await people(owner, { ...base, cf: { [key]: "Gold" } })).people)).toEqual([quiet]);
    expect(ids((await people(owner, { ...base, [`cf.${key}`]: "Gold" })).people)).toEqual([quiet]);

    // Persona: matches on title even when the contact has no persona set.
    const persona = await owner.post("/api/v1/personas", {
      data: { name: uniq("Widget chiefs"), titles: ["Chief Widget Officer"] },
    });
    expect(persona.status(), await persona.text()).toBe(201);
    const personaId = (await persona.json()).persona.id as string;
    expect(ids((await people(owner, { ...base, personaId: [personaId] })).people)).toEqual([replied]);
  });

  test("select-all ids honour the per-company cap", async () => {
    const api = await apiAsRole("member");
    const marker = uniq("Cap co");
    const one = await company({ name: `${marker} One` });
    const two = await company({ name: `${marker} Two` });
    for (let i = 0; i < 3; i++) await person({ companyId: one });
    await person({ companyId: two });
    const all = await (await api.post("/api/v1/mixed_people/ids", { data: { company: [marker] } })).json();
    expect(all.ids).toHaveLength(4);
    expect(all.total).toBe(4);
    const capped = await (
      await api.post("/api/v1/mixed_people/ids", { data: { company: [marker], maxPerCompany: 1 } })
    ).json();
    expect(capped.ids).toHaveLength(2);
    const limited = await (
      await api.post("/api/v1/mixed_people/ids", { data: { company: [marker], limit: 3 } })
    ).json();
    expect(limited.ids).toHaveLength(3);
  });

  test("export of a selection returns just those rows", async () => {
    const api = await apiAsRole("member");
    const marker = uniq("Export co");
    const co = await company({ name: marker });
    const a = await person({ companyId: co, firstName: "Exported" });
    await person({ companyId: co, firstName: "Skipped" });
    const res = await api.post("/api/v1/contacts/export", { data: { ids: [a] } });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const lines = (await res.text()).trim().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(a);
  });
});

test.describe("company search behaviour", () => {
  test("segments, facets and company filters", async () => {
    const owner = await apiAsRole("owner");
    const ownerId = await userId(ACME.owner);
    const marker = uniq("CoFacet");
    const small = await company({ name: `${marker} small`, employeeCount: 8, industry: "Retail", ownerId });
    const mid = await company({
      name: `${marker} mid`,
      employeeCount: 150,
      industry: "Retail",
      technologies: ["Stripe"],
    });
    const big = await company({ name: `${marker} big`, employeeCount: 20_000, industry: "Energy", country: "Canada" });

    let res = await companies(owner, { company: [marker], includeCounts: true });
    expect(res.segment_counts).toEqual({ total: 3, net_new: 3, saved: 1 });
    expect(facet(res.facets, "employeeRanges")).toEqual({ "1-10": 1, "101-200": 1, "10001+": 1 });
    expect(facet(res.facets, "industry")).toEqual({ Retail: 2, Energy: 1 });

    const list = await owner.post("/api/v1/labels", { data: { name: uniq("co-nn"), entityType: "company" } });
    const listId = (await list.json()).label.id as string;
    await owner.post("/api/v1/labels/add_entity_ids", { data: { listId, entityIds: [mid] } });
    res = await companies(owner, { company: [marker], includeCounts: true });
    expect(res.segment_counts?.net_new).toBe(2);
    expect(ids((await companies(owner, { company: [marker], listId: [listId] })).organizations)).toEqual([mid]);
    expect(ids((await companies(owner, { company: [marker], listExclude: [listId] })).organizations)).toEqual(
      [small, big].sort(),
    );
    expect(ids((await companies(owner, { company: [marker], employeeRanges: ["10001+"] })).organizations)).toEqual([
      big,
    ]);
    expect(ids((await companies(owner, { company: [marker], technologies: ["stripe"] })).organizations)).toEqual([mid]);
    expect(ids((await companies(owner, { company: [marker], location: ["canada"] })).organizations)).toEqual([big]);
    expect(ids((await companies(owner, { company: [marker], segment: "saved" })).organizations)).toEqual([small]);

    // Dynamic list built from the same filters.
    const dyn = await owner.post("/api/v1/labels", {
      data: {
        name: uniq("dyn"),
        entityType: "company",
        kind: "dynamic",
        filters: { company: [marker], industry: ["Retail"] },
      },
    });
    expect(dyn.status(), await dyn.text()).toBe(201);
    const dynList = (await dyn.json()).label as { id: string; memberCount: number };
    expect(dynList.memberCount).toBe(2);
    expect(ids((await companies(owner, { listId: [dynList.id] })).organizations)).toEqual([small, mid].sort());
  });

  test("company insights list the company's lists and people locations", async () => {
    const owner = await apiAsRole("owner");
    const co = await company({ name: uniq("Insight co") });
    await person({ companyId: co, city: "Lisbon", country: "Portugal" });
    const list = await owner.post("/api/v1/labels", { data: { name: uniq("ins"), entityType: "company" } });
    const listId = (await list.json()).label.id as string;
    await owner.post("/api/v1/labels/add_entity_ids", { data: { listId, entityIds: [co] } });
    const res = await owner.get(`/api/v1/accounts/${co}/insights`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.lists.map((l: { id: string }) => l.id)).toContain(listId);
    expect(body.peopleLocations).toEqual([{ location: "Lisbon, Portugal", count: 1 }]);
    expect(body.suggestedPeople).toEqual([]);
    expect((await owner.get(`/api/v1/accounts/${randomUUID()}/insights`)).status()).toBe(404);
  });
});
