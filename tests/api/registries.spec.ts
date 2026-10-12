import { type APIRequestContext, expect, test } from "@playwright/test";

import { closeDiscoDb, insertIndexCompany, q } from "../support/discovery-fixtures";
import { ROLES } from "../support/matrix";
import {
  CH,
  CH_ENDPOINT,
  CIK,
  REG_PORT,
  regHost,
  registryLog,
  SEC_DATA_ENDPOINT,
  SEC_ENDPOINT,
  startRegistryFixtures,
  WIKIDATA_ENDPOINT,
} from "../support/registry-fixtures";
import { apiAs, apiAsRole, GLOBEX_OWNER, PLATFORM_ADMIN } from "../support/session";

/**
 * Official registries as seed sources (Companies House, SEC EDGAR), run against local fixtures of
 * the registries' APIs and a Wikidata-like SPARQL endpoint. Covers: platform-admin-only access,
 * config validation, the missing-key refusal, domain resolution (Wikidata, the SEC's own website
 * field, exact unambiguous name match) and skip counting, current officers only with nothing
 * personal stored, opt-outs, idempotent re-runs and homepages queued for the crawler.
 */

const NAME = "Registry spec";
const HOSTS = `%-reg.localhost:${REG_PORT}`;
let fixtures: { close: () => Promise<void> } | null = null;

async function cleanup() {
  await q("delete from seed_source where name like $1", [`${NAME}%`]);
  await q("delete from index_company where domain like $1 or companies_house_number = any($2) or sec_cik = any($3)", [
    HOSTS,
    Object.values(CH),
    Object.values(CIK),
  ]);
  await q("delete from crawl_frontier where host like $1", [HOSTS]);
  await q("delete from crawl_host where host like $1", [HOSTS]);
  await q("delete from index_optout where value like '%-reg.localhost%'");
}

async function create(admin: APIRequestContext, kind: string, name: string, config: Record<string, unknown>) {
  const res = await admin.post("/api/v1/platform/seed_sources", { data: { kind, name: `${NAME} ${name}`, config } });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).seed_source as { id: string; requirement: { envVar: string } | null };
}

async function run(admin: APIRequestContext, id: string) {
  const res = await admin.post(`/api/v1/platform/seed_sources/${id}/run`, { data: {}, timeout: 120_000 });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).seed_source.stats as Record<string, unknown> & { errors: string[] };
}

async function company(where: string, value: string) {
  const [row] = await q<{
    id: string;
    domain: string;
    name: string | null;
    companies_house_number: string | null;
    sec_cik: string | null;
    city: string | null;
    country: string | null;
    founded_year: number | null;
    sources: Array<{ source: string; url: string; license?: string }>;
  }>(`select * from index_company where ${where} = $1`, [value]);
  return row ?? null;
}

async function people(companyId: string) {
  return q<{
    full_name: string;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    seniority: string | null;
    source: string;
    source_url: string;
    published_email: string | null;
    linkedin_url: string | null;
    gone_at: Date | null;
  }>("select * from index_person where company_id = $1 order by full_name", [companyId]);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fixtures = await startRegistryFixtures();
  await cleanup();
});

test.afterAll(async () => {
  await cleanup();
  await fixtures?.close();
  await closeDiscoDb();
});

test.describe("registry sources: access and validation", () => {
  for (const role of ROLES) {
    test(`Acme ${role} can't create or run registry sources (403)`, async () => {
      const api = await apiAsRole(role);
      for (const kind of ["companies_house", "sec_edgar"]) {
        const res = await api.post("/api/v1/platform/seed_sources", { data: { kind, name: `${NAME} forbidden` } });
        expect(res.status(), kind).toBe(403);
      }
      const [anySource] = await q<{ id: string }>("select id from seed_source where kind = 'sec_edgar' limit 1");
      if (anySource) {
        expect((await api.post(`/api/v1/platform/seed_sources/${anySource.id}/run`, { data: {} })).status()).toBe(403);
      }
    });
  }

  test("another workspace's owner gets 403", async () => {
    const api = await apiAs(GLOBEX_OWNER);
    const res = await api.post("/api/v1/platform/seed_sources", { data: { kind: "sec_edgar", name: `${NAME} x` } });
    expect(res.status()).toBe(403);
  });

  test("the platform administrator sees both registry kinds and gets 422 for bad config", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    const list = await (await admin.get("/api/v1/platform/seed_sources")).json();
    const kinds = new Set(list.seed_sources.map((s: { kind: string }) => s.kind));
    expect(kinds.has("companies_house")).toBe(true);
    expect(kinds.has("sec_edgar")).toBe(true);
    const bad: Array<[string, unknown]> = [
      ["companies_house", { sicCodes: ["abc"] }],
      ["companies_house", { apiKey: "never-in-config" }],
      ["companies_house", { maxCompanies: 0 }],
      ["sec_edgar", { formLookbackDays: 5 }],
      ["sec_edgar", { endpoint: "ftp://x" }],
    ];
    for (const [kind, config] of bad) {
      const res = await admin.post("/api/v1/platform/seed_sources", { data: { kind, name: `${NAME} bad`, config } });
      expect(res.status(), JSON.stringify(config)).toBe(422);
    }
  });

  test("without an API key Companies House refuses to run and says which variable to set", async () => {
    test.skip(Boolean(process.env.COMPANIES_HOUSE_API_KEY), "a key is configured on this machine");
    const admin = await apiAs(PLATFORM_ADMIN);
    const source = await create(admin, "companies_house", "no key", { maxCompanies: 5 });
    expect(source.requirement?.envVar).toBe("COMPANIES_HOUSE_API_KEY");
    const stats = await run(admin, source.id);
    expect(stats.requests).toBe(0);
    expect(stats.errors.join(" ")).toMatch(/API key missing.*COMPANIES_HOUSE_API_KEY/);
  });
});

test.describe("Companies House", () => {
  test("Wikidata-listed companies: current officers only, opt-outs honoured, re-runs idempotent", async () => {
    test.setTimeout(180_000);
    const admin = await apiAs(PLATFORM_ADMIN);
    const optouts = [
      { kind: "domain", value: "optedout-reg.localhost" },
      { kind: "person", value: "Siobhan O'Brien", domain: "northwind-reg.localhost" },
    ];
    for (const data of optouts) {
      const res = await admin.post("/api/v1/platform/optouts", { data });
      expect(res.status(), await res.text()).toBeLessThan(300);
    }
    const source = await create(admin, "companies_house", "wikidata", {
      endpoint: CH_ENDPOINT,
      wikidataEndpoint: WIKIDATA_ENDPOINT,
      maxCompanies: 50,
    });
    expect(source.requirement).toBeNull();

    const first = await run(admin, source.id);
    expect(first).toMatchObject({
      fetched: 4,
      candidates: 4,
      companiesAdded: 1,
      companiesMatched: 0,
      skippedBadWebsite: 1, // a LinkedIn page as the website
      skippedInactive: 1, // dissolved
      skippedOptedOut: 1,
      peopleAdded: 2,
      peopleOptedOut: 1,
      reachedEnd: true,
      cursor: 0,
      errors: [],
    });

    const northwind = await company("companies_house_number", CH.northwind);
    expect(northwind).toMatchObject({
      domain: regHost("northwind"),
      name: "Northwind Trading",
      city: "London",
      country: "United Kingdom",
      founded_year: 1999,
    });
    const sources = northwind?.sources.map((s) => `${s.source}|${s.license ?? ""}`) ?? [];
    expect(sources).toContain("companies_house|OGL-UK-3.0");
    expect(sources).toContain("wikidata|CC0-1.0");
    expect(await company("companies_house_number", CH.dissolved)).toBeNull();
    expect(await company("domain", regHost("optedout"))).toBeNull();

    const officers = await people(northwind?.id ?? "");
    expect(officers.map((p) => [p.full_name, p.title, p.source])).toEqual([
      ["Anna van der Berg", "LLP Designated Member", "companies_house"],
      ["John Michael Smith", "Director", "companies_house"],
    ]);
    for (const p of officers) {
      expect(p.source_url).toBe(
        `https://find-and-update.company-information.service.gov.uk/company/${CH.northwind}/officers`,
      );
      expect(p.published_email).toBeNull();
      expect(p.linkedin_url).toBeNull();
      expect(p.gone_at).toBeNull();
    }
    expect(officers.find((p) => p.full_name === "John Michael Smith")).toMatchObject({
      first_name: "John",
      last_name: "Michael Smith",
      seniority: "director",
    });
    // Nothing personal from the registry is stored anywhere in the person rows.
    const raw = JSON.stringify(await q("select * from index_person where company_id = $1", [northwind?.id]));
    expect(raw).not.toMatch(/1970|British|Home Street|N1 1AA|Former/);

    const queued = await q<{ url: string }>("select url from crawl_frontier where host = $1", [regHost("northwind")]);
    expect(queued.map((r) => r.url)).toEqual([`http://${regHost("northwind")}/`]);

    const second = await run(admin, source.id);
    expect(second).toMatchObject({
      companiesAdded: 0,
      companiesMatched: 1,
      peopleAdded: 0,
      peopleUpdated: 2,
      errors: [],
    });
    expect((second.totals as Record<string, number>).companiesAdded).toBe(1);
    expect((second.totals as Record<string, number>).peopleAdded).toBe(2);
    expect(await people(northwind?.id ?? "")).toHaveLength(2);
    const [count] = await q<{ n: number }>("select count(*)::int as n from index_company where domain like $1", [
      HOSTS,
    ]);
    expect(count?.n).toBe(1);
  });

  test("SIC-code search: exact unambiguous name match, otherwise skipped without a website", async () => {
    test.setTimeout(120_000);
    const admin = await apiAs(PLATFORM_ADMIN);
    await insertIndexCompany({ domain: regHost("quill"), name: "Quillfeather Widgets" });
    await insertIndexCompany({ domain: regHost("twin1"), name: "Twinleaf" });
    await insertIndexCompany({ domain: regHost("twin2"), name: "Twinleaf Ltd" });
    const source = await create(admin, "companies_house", "sic", {
      endpoint: CH_ENDPOINT,
      wikidataEndpoint: WIKIDATA_ENDPOINT,
      sicCodes: ["62012"],
    });
    const stats = await run(admin, source.id);
    expect(stats).toMatchObject({
      fetched: 3,
      companiesAdded: 0,
      companiesMatched: 1,
      skippedNoWebsite: 2,
      peopleAdded: 1,
      reachedEnd: true,
      errors: [],
    });
    const quill = await company("domain", regHost("quill"));
    expect(quill?.companies_house_number).toBe(CH.quill);
    expect(quill?.name).toBe("Quillfeather Widgets");
    expect((await people(quill?.id ?? "")).map((p) => p.full_name)).toEqual(["Quentin Feather"]);
    for (const twin of ["twin1", "twin2"])
      expect((await company("domain", regHost(twin)))?.companies_house_number).toBeNull();
    // Companies without a resolvable website cost no profile or officer request.
    const log = await registryLog();
    expect(log.some((r) => r.path.startsWith(`/company/${CH.noweb}`))).toBe(false);
  });
});

test.describe("SEC EDGAR", () => {
  test("websites from Wikidata or the filing company; officers and directors from recent Forms 3 and 4", async () => {
    test.setTimeout(120_000);
    const admin = await apiAs(PLATFORM_ADMIN);
    const source = await create(admin, "sec_edgar", "fixtures", {
      endpoint: SEC_ENDPOINT,
      dataEndpoint: SEC_DATA_ENDPOINT,
      wikidataEndpoint: WIKIDATA_ENDPOINT,
      formLookbackDays: 730,
    });
    expect(source.requirement).toBeNull();
    const first = await run(admin, source.id);
    expect(first).toMatchObject({
      fetched: 3,
      candidates: 3,
      companiesAdded: 2,
      skippedNoWebsite: 1,
      peopleAdded: 3,
      reachedEnd: true,
      errors: [],
    });

    const harbor = await company("sec_cik", CIK.harbor);
    expect(harbor).toMatchObject({
      domain: regHost("harbor"),
      name: "Harbor Robotics",
      city: "Boston",
      country: "United States",
    });
    expect(harbor?.sources.map((s) => `${s.source}|${s.license ?? ""}`)).toContain("sec_edgar|public-domain");
    const harborPeople = await people(harbor?.id ?? "");
    expect(harborPeople.map((p) => [p.full_name, p.title, p.source])).toEqual([
      ["Jane A Doe", "Chief Financial Officer", "sec_edgar"],
      ["Richard Roe", "Director", "sec_edgar"],
    ]);
    expect(harborPeople[0]?.source_url).toBe(
      `${SEC_ENDPOINT}/Archives/edgar/data/${CIK.harbor}/000990000126000002/0009900001-26-000002-index.htm`,
    );
    expect(harborPeople[0]?.seniority).toBe("c_suite");
    expect(JSON.stringify(harborPeople)).not.toMatch(/PRIVATE LANE|Oscar|Big Fund/i);

    const lighthouse = await company("sec_cik", CIK.lighthouse);
    expect(lighthouse?.domain).toBe(regHost("lighthouse"));
    expect((await people(lighthouse?.id ?? "")).map((p) => p.full_name)).toEqual(["Lucy Lantern"]);
    expect(await company("sec_cik", CIK.nowhere)).toBeNull();

    // No filings were fetched for the company without a website; every request named us.
    const log = (await registryLog()).filter((r) => r.host.startsWith("sec"));
    expect(log.some((r) => r.path.includes("/9900003/"))).toBe(false);
    for (const r of log) expect(r.userAgent.length).toBeGreaterThan(5);

    const second = await run(admin, source.id);
    expect(second).toMatchObject({ companiesAdded: 0, companiesMatched: 2, peopleAdded: 0, peopleUpdated: 3 });
    expect(await people(harbor?.id ?? "")).toHaveLength(2);
  });
});
