import { type APIRequestContext, expect, test } from "@playwright/test";

import {
  cleanDiscovery,
  closeDiscoDb,
  type DiscoFixture,
  disco,
  discoUrl,
  fixtureLog,
  q,
  setTeamVariant,
  startDiscoveryFixtures,
} from "../support/discovery-fixtures";
import { apiAs, PLATFORM_ADMIN } from "../support/session";

/**
 * The crawler fleet end to end, against the local discovery fixture sites (never a real site):
 * seeding, claiming, robots.txt, politeness, deny-list, extraction into the index (company,
 * people, job boards, news) with provenance, job-change marking on re-crawl, opt-outs and
 * Wikidata seeding from a canned SPARQL endpoint. Driven through the platform run_once endpoint,
 * which runs exactly the worker's code synchronously.
 */

const SPEC_SOURCE = "WP-F crawler spec";
const HOSTS = [disco("nimbus"), disco("ats"), disco("blocked")];
let fixture: DiscoFixture;
let admin: APIRequestContext;
let atsSourceId = "";
let atsOriginal: Record<string, unknown> = {};
let atsWasEnabled = true;

interface Processed {
  url: string;
  kind: string;
  host: string;
  outcome: string;
  reason: string | null;
}

async function runOnce(hosts: string[], max = 30, budgetMs = 150_000): Promise<Processed[]> {
  const res = await admin.post("/api/v1/platform/crawler/run_once", {
    data: { max, hosts, budgetMs },
    timeout: 240_000,
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).processed as Processed[];
}

async function createManualSource(name: string, text: string): Promise<string> {
  const res = await admin.post("/api/v1/platform/seed_sources", {
    data: { kind: "manual", name, text, enabled: false },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).seed_source.id as string;
}

async function runSource(id: string, refresh = false) {
  const res = await admin.post(`/api/v1/platform/seed_sources/${id}/run`, { data: { refresh }, timeout: 120_000 });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).seed_source as { stats: Record<string, unknown> };
}

async function frontierRow(url: string) {
  const rows = await q<{ status: string; skipped_reason: string | null; kind: string; host: string }>(
    "select status, skipped_reason, kind, host from crawl_frontier where url = $1",
    [url],
  );
  return rows[0] ?? null;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fixture = await startDiscoveryFixtures();
  await cleanDiscovery("%disco.localhost%");
  await q(
    "delete from crawl_frontier where host in ('linkedin.com', 'www.linkedin.com', 'facebook.com', 'www.facebook.com') and discovered_from like 'seed:%'",
  );
  await q("delete from seed_source where name like 'WP-F%'");
  await setTeamVariant("v1");
  admin = await apiAs(PLATFORM_ADMIN);

  // Point the job-board source at the fixture APIs (restored afterwards).
  const list = await admin.get("/api/v1/platform/seed_sources");
  expect(list.status()).toBe(200);
  const sources = (await list.json()).seed_sources as Array<{
    id: string;
    kind: string;
    enabled: boolean;
    config: Record<string, unknown>;
  }>;
  const ats = sources.find((s) => s.kind === "ats_boards");
  expect(ats).toBeTruthy();
  atsSourceId = ats?.id ?? "";
  atsOriginal = ats?.config ?? {};
  atsWasEnabled = ats?.enabled ?? true;
  const patched = await admin.patch(`/api/v1/platform/seed_sources/${atsSourceId}`, {
    data: {
      enabled: true,
      config: {
        endpoints: {
          greenhouse: `http://${disco("ats")}`,
          lever: `http://${disco("ats")}`,
          ashby: `http://${disco("ats")}`,
        },
      },
    },
  });
  expect(patched.status(), await patched.text()).toBe(200);
});

test.afterAll(async () => {
  if (atsSourceId) {
    await admin.patch(`/api/v1/platform/seed_sources/${atsSourceId}`, {
      data: { enabled: atsWasEnabled, config: { endpoints: {}, ...atsOriginal } },
    });
  }
  await setTeamVariant("v1");
  await q("delete from seed_source where name like 'WP-F%'");
  // Leave no fixture companies in a real index (the next run starts clean anyway).
  await cleanDiscovery("%disco.localhost%");
  await closeDiscoDb();
  await fixture.close();
});

test("a manual seed queues homepages and records deny-listed hosts as skipped, never fetched", async () => {
  const id = await createManualSource(
    `${SPEC_SOURCE} seeds`,
    [
      discoUrl("nimbus"),
      discoUrl("blocked"),
      "linkedin.com",
      "https://www.facebook.com/somecompany",
      "crunchbase.com",
    ].join("\n"),
  );
  const run = await runSource(id, true);
  expect(Number(run.stats.queued) + Number(run.stats.requeued)).toBeGreaterThanOrEqual(2);
  expect(Number(run.stats.skipped)).toBeGreaterThanOrEqual(3);

  for (const denied of ["https://linkedin.com/", "https://www.facebook.com/", "https://crunchbase.com/"]) {
    const row = await frontierRow(denied);
    expect(row, denied).not.toBeNull();
    expect(row?.status).toBe("skipped");
    expect(row?.skipped_reason).toBe("denylist");
  }
  expect((await frontierRow(discoUrl("nimbus")))?.status).toBe("queued");
});

test("run_once crawls the fixture politely and fills the index with provenance", async () => {
  test.setTimeout(240_000);
  const processed = await runOnce(HOSTS);
  const byUrl = new Map(processed.map((p) => [p.url, p]));

  // robots.txt: /contact is disallowed for everyone, and the blocked site disallows everything.
  const contact = await frontierRow(discoUrl("nimbus", "/contact"));
  expect(contact?.status).toBe("skipped");
  expect(contact?.skipped_reason).toBe("robots");
  const blocked = await frontierRow(discoUrl("blocked"));
  expect(blocked?.status).toBe("skipped");
  expect(blocked?.skipped_reason).toBe("robots");

  const log = await fixtureLog();
  const nimbusHits = log.filter((r) => r.host === disco("nimbus"));
  expect(nimbusHits.some((r) => r.path === "/contact")).toBe(false);
  expect(nimbusHits.some((r) => r.path.startsWith("/private"))).toBe(false);
  expect(log.filter((r) => r.host === disco("blocked")).map((r) => r.path)).toEqual(["/robots.txt"]);
  // Identifies itself with a contact URL.
  expect(nimbusHits.every((r) => /^AnhourLeadsBot\/[\d.]+ \(\+https?:\/\//.test(r.userAgent))).toBe(true);

  // Politeness: one request at a time per host, at least the robots.txt Crawl-delay (2.5 s) apart.
  const times = nimbusHits.map((r) => r.at).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(2_400);
  const [host] = await q<{ crawl_delay_ms: number; robots_txt: string | null; error_count: number }>(
    "select crawl_delay_ms, robots_txt, error_count from crawl_host where host = $1",
    [disco("nimbus")],
  );
  expect(host?.crawl_delay_ms).toBe(2_500);
  expect(host?.robots_txt).toContain("Crawl-delay");
  expect(host?.error_count).toBe(0);

  // Pages of interest were followed; other links were not.
  for (const path of ["/", "/about", "/team", "/careers", "/news/feed.xml"]) {
    expect(byUrl.get(discoUrl("nimbus", path))?.outcome, path).toBe("done");
  }
  expect(await frontierRow(discoUrl("nimbus", "/blog/some-post"))).toBeNull();
  // Social links are stored on the company, never queued or fetched.
  const social = await q(
    "select 1 from crawl_frontier where (host like '%linkedin.com' or host like '%facebook.com' or host = 'x.com') and discovered_from like $1",
    [`%${disco("nimbus")}%`],
  );
  expect(social).toHaveLength(0);

  // Company with provenance.
  const [company] = await q<{
    id: string;
    name: string;
    description: string;
    founded_year: number;
    employee_count: number;
    employee_range: string;
    city: string;
    country: string;
    linkedin_url: string;
    twitter_url: string;
    technologies: string[];
    email_pattern: string | null;
    sources: Array<{ source: string; url: string }>;
  }>("select * from index_company where domain = $1", [disco("nimbus")]);
  expect(company?.name).toBe("Nimbus Analytics");
  expect(company?.founded_year).toBe(2015);
  expect(company?.employee_count).toBe(42);
  expect(company?.employee_range).toBe("21-50");
  expect(company?.city).toBe("Toronto");
  expect(company?.country).toBe("Canada");
  expect(company?.linkedin_url).toBe("https://www.linkedin.com/company/nimbus-disco");
  expect(company?.twitter_url).toBe("https://x.com/nimbusdisco");
  expect(company?.technologies).toContain("HubSpot");
  expect(company?.email_pattern).toBe("{first}.{last}");
  const sources = company?.sources ?? [];
  expect(sources.some((s) => s.source === "crawl" && s.url === discoUrl("nimbus"))).toBe(true);
  expect(sources.some((s) => s.source === "rss")).toBe(true);
  expect(sources.some((s) => s.source === "ats:greenhouse")).toBe(true);

  // People from the team page, with seniority and department from their titles.
  const people = await q<{
    full_name: string;
    seniority: string;
    department: string;
    published_email: string | null;
    source_url: string;
  }>(
    "select full_name, seniority, department, published_email, source_url from index_person where company_id = $1 order by full_name",
    [company?.id],
  );
  expect(people.map((p) => p.full_name)).toEqual(["Ada Lovelace", "Alan Turing", "Grace Hopper"]);
  const ada = people.find((p) => p.full_name === "Ada Lovelace");
  expect(ada?.seniority).toBe("c_suite");
  expect(ada?.department).toBe("C-Suite");
  expect(ada?.published_email).toBe("ada.lovelace@nimbus-disco.localhost");
  expect(ada?.source_url).toBe(discoUrl("nimbus", "/team"));
  expect(people.find((p) => p.full_name === "Grace Hopper")?.seniority).toBe("vp");
  const alan = people.find((p) => p.full_name === "Alan Turing");
  expect(alan?.seniority).toBe("senior");
  expect(alan?.department).toBe("Engineering & Technical");

  // Job boards through their public APIs (the board pages themselves are never fetched).
  const jobs = await q<{ title: string; source: string; department: string | null; location: string | null }>(
    "select title, source, department, location from index_job_posting where company_id = $1 order by title",
    [company?.id],
  );
  expect(jobs.map((j) => `${j.source}:${j.title}`)).toEqual([
    "Greenhouse:Account Executive",
    "Lever:Product Designer",
    "Greenhouse:Senior Data Engineer",
  ]);
  expect(jobs.find((j) => j.title === "Senior Data Engineer")?.department).toBe("Engineering");
  expect(jobs.find((j) => j.title === "Account Executive")?.department).toBe("Sales");
  const atsRows = await q<{ url: string; status: string }>(
    "select url, status from crawl_frontier where kind = 'ats' and host = $1",
    [disco("ats")],
  );
  expect(atsRows.map((r) => r.status)).toEqual(["done", "done"]);
  expect(log.some((r) => r.host.includes("greenhouse.io") || r.host.includes("lever.co"))).toBe(false);

  // News from the RSS feed.
  const news = await q<{ title: string; published_at: Date | null }>(
    "select title, published_at from index_news where company_id = $1 order by published_at desc",
    [company?.id],
  );
  expect(news.map((n) => n.title)).toEqual(["Nimbus raises a seed round", "Nimbus & Partners launch forecasting 2.0"]);
});

test("re-crawling the team page marks people no longer listed as gone", async () => {
  test.setTimeout(120_000);
  await setTeamVariant("v2");
  await q("update crawl_frontier set status = 'queued', next_attempt_at = now() where url = $1", [
    discoUrl("nimbus", "/team"),
  ]);
  await q("update crawl_host set next_allowed_at = null where host = $1", [disco("nimbus")]);
  const processed = await runOnce([disco("nimbus")], 1);
  expect(processed[0]?.url).toBe(discoUrl("nimbus", "/team"));
  expect(processed[0]?.outcome).toBe("done");
  const people = await q<{ full_name: string; gone_at: Date | null }>(
    "select p.full_name, p.gone_at from index_person p join index_company c on c.id = p.company_id where c.domain = $1 order by p.full_name",
    [disco("nimbus")],
  );
  expect(people.find((p) => p.full_name === "Alan Turing")?.gone_at).not.toBeNull();
  expect(people.find((p) => p.full_name === "Ada Lovelace")?.gone_at).toBeNull();
  expect(people.find((p) => p.full_name === "Grace Hopper")?.gone_at).toBeNull();

  // Seen again → no longer gone.
  await setTeamVariant("v1");
  await q("update crawl_frontier set status = 'queued', next_attempt_at = now() where url = $1", [
    discoUrl("nimbus", "/team"),
  ]);
  await q("update crawl_host set next_allowed_at = null where host = $1", [disco("nimbus")]);
  await runOnce([disco("nimbus")], 1);
  const [alan] = await q<{ gone_at: Date | null }>(
    "select gone_at from index_person where full_name = 'Alan Turing' and source_url = $1",
    [discoUrl("nimbus", "/team")],
  );
  expect(alan?.gone_at).toBeNull();
});

test("opted-out domains are never crawled and opted-out people never come back", async () => {
  test.setTimeout(120_000);
  // Domain opt-out before the site is ever seeded.
  const added = await admin.post("/api/v1/platform/optouts", {
    data: { kind: "domain", value: "optout-disco.localhost", reason: "spec" },
  });
  expect([200, 201]).toContain(added.status());
  const id = await createManualSource(`${SPEC_SOURCE} optout`, discoUrl("optout"));
  await runSource(id);
  const row = await frontierRow(discoUrl("optout"));
  expect(row?.status).toBe("skipped");
  expect(row?.skipped_reason).toBe("opted_out");
  await runOnce([disco("optout")], 5, 5_000);
  expect(await q("select 1 from index_company where domain = $1", [disco("optout")])).toHaveLength(0);
  expect((await fixtureLog()).some((r) => r.host === disco("optout"))).toBe(false);

  // Person opt-out: deleted now and not re-added by the next crawl of their page.
  const person = await admin.post("/api/v1/platform/optouts", {
    data: { kind: "person", value: "Grace Hopper", domain: "nimbus-disco.localhost" },
  });
  expect([200, 201]).toContain(person.status());
  const body = await person.json();
  expect(body.removed.people).toBeGreaterThanOrEqual(body.created ? 1 : 0);
  await q("update crawl_frontier set status = 'queued', next_attempt_at = now() where url = $1", [
    discoUrl("nimbus", "/team"),
  ]);
  await q("update crawl_host set next_allowed_at = null where host = $1", [disco("nimbus")]);
  await runOnce([disco("nimbus")], 1);
  const names = (
    await q<{ full_name: string }>("select full_name from index_person where source_url = $1", [
      discoUrl("nimbus", "/team"),
    ])
  ).map((p) => p.full_name);
  expect(names).toContain("Ada Lovelace");
  expect(names).not.toContain("Grace Hopper");
});

test("real-web shapes: big pages read up to the cap, product headings aren't people, big boards, moved homepages", async () => {
  test.setTimeout(240_000);
  const id = await createManualSource(`${SPEC_SOURCE} real web`, [discoUrl("bulky"), discoUrl("moved")].join("\n"));
  await runSource(id, true);
  const processed = await runOnce([disco("bulky"), disco("moved"), disco("newhome"), disco("ats")], 20, 180_000);
  const byUrl = new Map(processed.map((p) => [p.url, p]));

  // A ~2.5 MB homepage is read up to the cap (2 MB) and its facts still come through.
  expect(byUrl.get(discoUrl("bulky"))?.outcome).toBe("done");
  const [bulky] = await q<{ id: string; name: string | null }>("select id, name from index_company where domain = $1", [
    disco("bulky"),
  ]);
  expect(bulky?.name).toBe("Bulky Systems");

  // Name-shaped headings for products, plans and customer logos are not people.
  const people = await q<{ full_name: string }>("select full_name from index_person where company_id = $1", [
    bulky?.id,
  ]);
  expect(people.map((p) => p.full_name)).toEqual(["Mary Major"]);

  // An Ashby board answer of ~3 MB (full descriptions) is read whole.
  const board = `http://${disco("ats")}/posting-api/job-board/bulkydisco`;
  expect(byUrl.get(board)?.outcome).toBe("done");
  const [jobs] = await q<{ n: number }>("select count(*)::int as n from index_job_posting where company_id = $1", [
    bulky?.id,
  ]);
  expect(jobs?.n).toBe(300);

  // A seeded homepage that moved to another domain: the new domain is crawled as the company.
  expect((await frontierRow(discoUrl("moved")))?.skipped_reason).toBe("moved");
  expect(byUrl.get(discoUrl("newhome"))?.outcome).toBe("done");
  expect(await q("select 1 from index_company where domain = $1", [disco("newhome")])).toHaveLength(1);
});

test("Wikidata seeding reads a SPARQL endpoint politely and upserts companies with CC0 provenance", async () => {
  test.setTimeout(120_000);
  const created = await admin.post("/api/v1/platform/seed_sources", {
    data: {
      kind: "wikidata",
      name: `${SPEC_SOURCE} wikidata`,
      config: { endpoint: `http://${disco("wikidata")}/sparql`, maxRows: 6, pageSize: 3, countries: ["Q16"] },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const id = (await created.json()).seed_source.id as string;
  const run = await runSource(id);
  expect(run.stats.errors).toEqual([]);
  expect(run.stats.companies).toBe(2);

  const [acme] = await q<{
    name: string;
    country: string;
    industry: string;
    employee_count: number;
    founded_year: number;
    city: string;
    sources: Array<{ source: string; url: string; license?: string }>;
  }>("select * from index_company where domain = $1", [disco("wikiacme")]);
  expect(acme?.name).toBe("Acme Wiki Industries");
  expect(acme?.country).toBe("Canada");
  expect(acme?.industry).toBe("software industry");
  expect(acme?.employee_count).toBe(120);
  expect(acme?.founded_year).toBe(2009);
  expect(acme?.city).toBe("Montreal");
  expect(acme?.sources[0]).toMatchObject({
    source: "wikidata",
    url: "https://www.wikidata.org/wiki/Q90000001",
    license: "CC0-1.0",
  });
  // An item whose only label is its id gets no name rather than "Q…".
  const [beta] = await q<{ name: string | null }>("select name from index_company where domain = $1", [
    disco("wikibeta"),
  ]);
  expect(beta?.name).toBeNull();
  // The social-network "website" is never queued for crawling.
  expect((await frontierRow("https://www.linkedin.com/"))?.skipped_reason ?? "denylist").toBe("denylist");
  expect((await frontierRow(discoUrl("wikiacme")))?.status).toBe("queued");
  // The SPARQL request carried the country filter, LIMIT/OFFSET paging and our user agent.
  const sparql = (await fixtureLog()).filter((r) => r.host === disco("wikidata"));
  expect(sparql.length).toBeGreaterThanOrEqual(1);
  expect(sparql[0]?.userAgent).toMatch(/^AnhourLeadsBot/);
});

test("admin can block a host: its URLs stay queued until unblocked", async () => {
  await q("update crawl_frontier set status = 'queued', next_attempt_at = now() where url = $1", [
    discoUrl("wikiacme"),
  ]);
  const blocked = await admin.post(`/api/v1/platform/crawler/hosts/${encodeURIComponent(disco("wikiacme"))}/block`, {
    data: { reason: "spec" },
  });
  expect(blocked.status(), await blocked.text()).toBe(200);
  expect((await blocked.json()).host.blocked).toBe(true);
  expect(await runOnce([disco("wikiacme")], 2, 3_000)).toEqual([]);
  expect((await frontierRow(discoUrl("wikiacme")))?.status).toBe("queued");

  const unblocked = await admin.post(`/api/v1/platform/crawler/hosts/${encodeURIComponent(disco("wikiacme"))}/unblock`);
  expect(unblocked.status()).toBe(200);
  const processed = await runOnce([disco("wikiacme")], 1, 30_000);
  expect(processed[0]?.url).toBe(discoUrl("wikiacme"));
  expect(processed[0]?.outcome).toBe("done");

  const stats = await admin.get("/api/v1/platform/crawler/stats");
  expect(stats.status()).toBe(200);
  const body = await stats.json();
  expect(body.index.companies).toBeGreaterThanOrEqual(3);
  expect(body.throughput).toHaveLength(60);
  expect(body.pagesLastHour).toBeGreaterThan(0);
  expect(body.frontier.done).toBeGreaterThan(0);
});
