import { expect, test } from "@playwright/test";

import { closeDiscoDb, insertIndexCompany, insertIndexPerson, insertJob, q } from "../support/discovery-fixtures";
import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAs, apiAsRole, apiWithKey, GLOBEX_OWNER, PLATFORM_ADMIN } from "../support/session";
import { closeDb, createApiKey } from "./white-label-helpers";

/**
 * Discovery index as workspaces use it: search people and companies, net new / saved flags,
 * save to the workspace with provenance and dedupe, "Access email", opt-outs, and Acme / Globex
 * isolation. Index rows are inserted directly (unique domains per run) so the spec doesn't wait
 * on a crawl; crawler-worker.spec.ts covers how rows get there.
 */

const RUN = Date.now().toString(36);
const A = `orbit-${RUN}.disco.test`;
const B = `zenith-${RUN}.disco.test`;
const C = `optco-${RUN}.disco.test`;
const DOMAINS = [A, B, C];

const ids = { a: "", b: "", c: "", maya: "", leo: "", gone: "", ida: "", pat: "" };
const optoutIds: string[] = [];

interface PersonRow {
  id: string;
  name: string;
  title: string | null;
  seniority: string | null;
  department: string | null;
  emailAvailable: boolean;
  netNew: boolean;
  savedContactId: string | null;
  goneAt: string | null;
  company: { id: string; domain: string; name: string | null };
}

interface CompanyRow {
  id: string;
  domain: string;
  name: string | null;
  hiring: boolean;
  peopleCount: number;
  netNew: boolean;
  savedCompanyId: string | null;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  ids.a = await insertIndexCompany({
    domain: A,
    name: "Orbit Forecasting",
    industry: "Computer Software",
    country: "Canada",
    city: "Toronto",
    employeeCount: 42,
    employeeRange: "21-50",
    foundedYear: 2015,
    technologies: ["HubSpot", "Stripe"],
    keywords: ["forecasting"],
    emailPattern: "{first}.{last}",
  });
  ids.b = await insertIndexCompany({
    domain: B,
    name: "Zenith Health",
    industry: "Hospital & Health Care",
    country: "Germany",
    city: "Berlin",
    employeeCount: 600,
    employeeRange: "501-1000",
    foundedYear: 1990,
  });
  ids.c = await insertIndexCompany({ domain: C, name: "Optco", country: "Canada" });
  ids.maya = await insertIndexPerson({
    companyId: ids.a,
    fullName: "Maya Chen",
    title: "Chief Executive Officer",
    seniority: "c_suite",
    department: "C-Suite",
    publishedEmail: `maya.chen@${A}`,
    sourceUrl: `https://${A}/team`,
  });
  ids.leo = await insertIndexPerson({
    companyId: ids.a,
    fullName: "Leo Park",
    title: "VP Sales",
    seniority: "vp",
    department: "Sales",
    sourceUrl: `https://${A}/team`,
  });
  ids.gone = await insertIndexPerson({
    companyId: ids.a,
    fullName: "Former Person",
    title: "Senior Engineer",
    seniority: "senior",
    department: "Engineering & Technical",
    sourceUrl: `https://${A}/team`,
    goneAt: new Date(),
  });
  ids.ida = await insertIndexPerson({
    companyId: ids.b,
    fullName: "Ida Weiss",
    title: "Head of Marketing",
    seniority: "head",
    department: "Marketing",
    sourceUrl: `https://${B}/about`,
  });
  ids.pat = await insertIndexPerson({
    companyId: ids.c,
    fullName: "Pat Opt",
    title: "Founder",
    seniority: "founder",
    department: "C-Suite",
    sourceUrl: `https://${C}/`,
  });
  await insertJob(ids.a, "Data Engineer", `https://boards.greenhouse.io/orbit${RUN}/jobs/1`, 2);
  await insertJob(ids.b, "Nurse", `https://boards.greenhouse.io/zenith${RUN}/jobs/1`, 60);
});

test.afterAll(async () => {
  const admin = await apiAs(PLATFORM_ADMIN);
  for (const id of optoutIds) await admin.delete(`/api/v1/platform/optouts/${id}`);
  await q("delete from contact where email like $1 or company_id in (select id from company where domain like $1)", [
    `%${RUN}.disco.test`,
  ]);
  await q("delete from company where domain like $1", [`%${RUN}.disco.test`]);
  await q("delete from index_company where domain like $1", [`%${RUN}.disco.test`]);
  await q("delete from index_optout where value like $1", [`%${RUN}.disco.test%`]);
  await closeDiscoDb();
  await closeDb();
});

async function searchPeople(email: string, body: Record<string, unknown> = {}) {
  const api = await apiAs(email);
  const res = await api.post("/api/v1/index/people/search", { data: { domains: DOMAINS, per_page: 50, ...body } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as {
    people: PersonRow[];
    pagination: { total_entries: number };
    counts?: Record<string, number>;
  };
}

async function searchCompanies(email: string, body: Record<string, unknown> = {}) {
  const api = await apiAs(email);
  const res = await api.post("/api/v1/index/companies/search", { data: { domains: DOMAINS, per_page: 50, ...body } });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as {
    companies: CompanyRow[];
    pagination: { total_entries: number };
    counts?: Record<string, number>;
  };
}

const names = (rows: PersonRow[]) => rows.map((p) => p.name).sort();

test.describe("index: roles and validation", () => {
  for (const role of ROLES) {
    test(`${role} follows the matrix on every index endpoint`, async () => {
      test.setTimeout(120_000);
      const api = await apiAsRole(role);
      expect((await api.post("/api/v1/index/people/search", { data: { domains: DOMAINS } })).status()).toBe(
        expected(role, "search:run"),
      );
      expect((await api.post("/api/v1/index/companies/search", { data: { domains: DOMAINS } })).status()).toBe(
        expected(role, "search:run"),
      );
      expect((await api.get(`/api/v1/index/companies/${ids.a}`)).status()).toBe(expected(role, "search:run"));
      // Unknown ids: allowed roles get a 200 report with nothing saved, others 403.
      const people = await api.post("/api/v1/index/people/save", { data: { ids: ["no-such-person"] } });
      expect(people.status()).toBe(expected(role, "contact:create"));
      if (people.status() === 200)
        expect((await people.json()).skipped).toEqual([{ indexId: "no-such-person", reason: "not_found" }]);
      expect((await api.post("/api/v1/index/companies/save", { data: { ids: ["no-such-company"] } })).status()).toBe(
        expected(role, "company:create"),
      );
      expect((await api.post("/api/v1/index/people/access_email", { data: { id: "no-such-person" } })).status()).toBe(
        expected(role, "enrich:run", 404),
      );
    });
  }

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    expect((await api.post("/api/v1/index/people/search", { data: {} })).status()).toBe(401);
    expect((await api.post("/api/v1/index/companies/search", { data: {} })).status()).toBe(401);
    expect((await api.get(`/api/v1/index/companies/${ids.a}`)).status()).toBe(401);
    expect((await api.post("/api/v1/index/people/save", { data: { ids: [ids.maya] } })).status()).toBe(401);
    expect((await api.post("/api/v1/index/companies/save", { data: { ids: [ids.a] } })).status()).toBe(401);
    expect((await api.post("/api/v1/index/people/access_email", { data: { id: ids.maya } })).status()).toBe(401);
  });

  test("API keys use their own role", async () => {
    const { secret, remove } = await createApiKey(ACME.owner, "viewer");
    try {
      const api = await apiWithKey(secret);
      expect((await api.post("/api/v1/index/companies/search", { data: { domains: DOMAINS } })).status()).toBe(200);
      expect((await api.post("/api/v1/index/companies/save", { data: { ids: [ids.a] } })).status()).toBe(403);
    } finally {
      await remove();
    }
  });

  test("cross-site cookie writes are refused", async () => {
    const api = await apiAsRole("member");
    const headers = { origin: "https://evil.example" };
    expect((await api.post("/api/v1/index/people/search", { data: {}, headers })).status()).toBe(403);
    expect((await api.post("/api/v1/index/people/save", { data: { ids: [ids.maya] }, headers })).status()).toBe(403);
    expect((await api.post("/api/v1/index/companies/save", { data: { ids: [ids.a] }, headers })).status()).toBe(403);
  });

  test("invalid input gets 422", async () => {
    const api = await apiAsRole("member");
    expect((await api.post("/api/v1/index/people/search", { data: { seniority: ["boss"] } })).status()).toBe(422);
    expect((await api.post("/api/v1/index/companies/search", { data: { employeeRanges: ["lots"] } })).status()).toBe(
      422,
    );
    expect((await api.post("/api/v1/index/companies/search", { data: { unknownFilter: 1 } })).status()).toBe(422);
    expect((await api.post("/api/v1/index/people/save", { data: { ids: [] } })).status()).toBe(422);
    expect(
      (
        await api.post("/api/v1/index/companies/save", {
          data: { ids: Array.from({ length: 101 }, (_, i) => `x${i}`) },
        })
      ).status(),
    ).toBe(422);
    expect((await api.post("/api/v1/index/people/access_email", { data: {} })).status()).toBe(422);
  });

  test("unknown company id gets 404", async () => {
    const api = await apiAsRole("viewer");
    expect((await api.get("/api/v1/index/companies/no-such-company")).status()).toBe(404);
  });
});

test.describe("index: search", () => {
  test("people filters: titles, seniority, department, location, industry, technologies, size, hiring, email", async () => {
    const all = await searchPeople(ACME.member);
    expect(names(all.people)).toEqual(["Ida Weiss", "Leo Park", "Maya Chen", "Pat Opt"]);
    expect((await searchPeople(ACME.member, { includeGone: true })).people.map((p) => p.name)).toContain(
      "Former Person",
    );
    expect(names((await searchPeople(ACME.member, { titles: ["chief", "head of"] })).people)).toEqual([
      "Ida Weiss",
      "Maya Chen",
    ]);
    expect(names((await searchPeople(ACME.member, { titlesExclude: ["vp"] })).people)).toEqual([
      "Ida Weiss",
      "Maya Chen",
      "Pat Opt",
    ]);
    expect(names((await searchPeople(ACME.member, { seniority: ["vp", "head"] })).people)).toEqual([
      "Ida Weiss",
      "Leo Park",
    ]);
    expect(names((await searchPeople(ACME.member, { department: ["sales"] })).people)).toEqual(["Leo Park"]);
    expect(names((await searchPeople(ACME.member, { country: ["germany"] })).people)).toEqual(["Ida Weiss"]);
    expect(names((await searchPeople(ACME.member, { industry: ["software"] })).people)).toEqual([
      "Leo Park",
      "Maya Chen",
    ]);
    expect(names((await searchPeople(ACME.member, { technologies: ["hubspot"] })).people)).toEqual([
      "Leo Park",
      "Maya Chen",
    ]);
    expect(names((await searchPeople(ACME.member, { employeeRanges: ["501-1000"] })).people)).toEqual(["Ida Weiss"]);
    expect(names((await searchPeople(ACME.member, { hiring: true })).people)).toEqual(["Leo Park", "Maya Chen"]);
    expect(names((await searchPeople(ACME.member, { hasEmail: true })).people)).toEqual(["Maya Chen"]);
    expect(names((await searchPeople(ACME.member, { q: "zenith" })).people)).toEqual(["Ida Weiss"]);
    expect(names((await searchPeople(ACME.member, { domainsExclude: [A, C] })).people)).toEqual(["Ida Weiss"]);
    const maya = all.people.find((p) => p.name === "Maya Chen");
    // The published address is not revealed by search; "Access email" reveals it.
    expect(maya).toMatchObject({
      emailAvailable: true,
      seniority: "c_suite",
      department: "C-Suite",
      company: { domain: A },
    });
    expect(JSON.stringify(all)).not.toContain(`maya.chen@${A}`);
  });

  test("company filters: founded year, employees, keywords, hiring, has email, counts", async () => {
    const all = await searchCompanies(ACME.member, { includeCounts: true });
    expect(all.companies.map((c) => c.domain).sort()).toEqual([...DOMAINS].sort());
    expect(all.counts).toMatchObject({ total: 3 });
    expect((await searchCompanies(ACME.member, { foundedMin: 2000 })).companies.map((c) => c.domain)).toEqual([A]);
    expect((await searchCompanies(ACME.member, { employeesMin: 100 })).companies.map((c) => c.domain)).toEqual([B]);
    expect((await searchCompanies(ACME.member, { keywords: ["forecasting"] })).companies.map((c) => c.domain)).toEqual([
      A,
    ]);
    expect((await searchCompanies(ACME.member, { hiring: true })).companies.map((c) => c.domain)).toEqual([A]);
    expect((await searchCompanies(ACME.member, { hasEmail: true })).companies.map((c) => c.domain)).toEqual([A]);
    const orbit = all.companies.find((c) => c.domain === A);
    expect(orbit).toMatchObject({ name: "Orbit Forecasting", hiring: true, peopleCount: 2 });
  });

  test("company detail: people (gone ones flagged), job postings, provenance", async () => {
    const api = await apiAsRole("viewer");
    const res = await api.get(`/api/v1/index/companies/${ids.a}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.company).toMatchObject({ domain: A, hiring: true, emailPattern: "{first}.{last}" });
    expect(body.people.map((p: PersonRow) => p.name)).toEqual(["Leo Park", "Maya Chen", "Former Person"]);
    expect(body.people.find((p: PersonRow) => p.name === "Former Person").goneAt).not.toBeNull();
    expect(body.jobs.map((j: { title: string }) => j.title)).toEqual(["Data Engineer"]);
    expect(body.provenance[0]).toMatchObject({ source: "crawl", url: `https://${A}/` });
    expect(JSON.stringify(body)).not.toContain(`maya.chen@${A}`);
  });
});

test.describe("index: opt-outs", () => {
  test("opted-out people and domains disappear from search and can't be saved", async () => {
    const admin = await apiAs(PLATFORM_ADMIN);
    const person = await admin.post("/api/v1/platform/optouts", {
      data: { kind: "person", value: "Leo Park", domain: A },
    });
    expect(person.status(), await person.text()).toBe(201);
    optoutIds.push((await person.json()).optout.id);
    // The person row is deleted; search and save leave the person out either way.
    expect(names((await searchPeople(ACME.member)).people)).not.toContain("Leo Park");
    const domain = await admin.post("/api/v1/platform/optouts", {
      data: { kind: "domain", value: `https://www.${C}/about` },
    });
    expect(domain.status(), await domain.text()).toBe(201);
    const domainBody = await domain.json();
    expect(domainBody.optout.value).toBe(C);
    expect(domainBody.removed.companies).toBe(1);
    optoutIds.push(domainBody.optout.id);
    expect((await searchCompanies(ACME.member)).companies.map((c) => c.domain)).not.toContain(C);
    expect(names((await searchPeople(ACME.member)).people)).not.toContain("Pat Opt");

    const api = await apiAsRole("member");
    const saved = await api.post("/api/v1/index/people/save", { data: { ids: [ids.leo, ids.pat] } });
    expect(saved.status()).toBe(200);
    expect((await saved.json()).saved).toEqual([]);
    const companies = await api.post("/api/v1/index/companies/save", { data: { ids: [ids.c] } });
    expect((await companies.json()).skipped).toEqual([{ indexId: ids.c, reason: "not_found" }]);
  });
});

test.describe("index: save to workspace", () => {
  test("saving companies copies them with provenance, dedupes, and flips net new for that workspace only", async () => {
    const acme = await apiAsRole("member");
    const before = await searchCompanies(ACME.member, { segment: "net_new" });
    expect(before.companies.map((c) => c.domain)).toContain(A);

    const res = await acme.post("/api/v1/index/companies/save", { data: { ids: [ids.a] } });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.saved).toHaveLength(1);
    const companyId = body.saved[0].id as string;
    const [row] = await q<{
      name: string;
      domain: string;
      source: string;
      industry: string;
      employee_count: number;
      email_pattern: string;
      technologies: string[];
    }>(
      "select name, domain, source, industry, employee_count, email_pattern, technologies from company where id = $1",
      [companyId],
    );
    expect(row).toMatchObject({
      name: "Orbit Forecasting",
      domain: A,
      source: "discovery_index",
      industry: "Computer Software",
      employee_count: 42,
      email_pattern: "{first}.{last}",
    });
    expect(row?.technologies).toEqual(["HubSpot", "Stripe"]);
    const provenance = await q<{ field: string; source: string; source_url: string | null }>(
      "select field, source, source_url from field_provenance where entity_id = $1",
      [companyId],
    );
    expect(provenance.length).toBeGreaterThan(5);
    expect(provenance.every((p) => p.source === "discovery_index" && p.source_url === `https://${A}/`)).toBe(true);

    // Saving again finds the existing company.
    const again = await acme.post("/api/v1/index/companies/save", { data: { ids: [ids.a] } });
    expect((await again.json()).existing).toEqual([{ indexId: ids.a, id: companyId }]);

    const acmeView = (await searchCompanies(ACME.member)).companies.find((c) => c.domain === A);
    expect(acmeView).toMatchObject({ netNew: false, savedCompanyId: companyId });
    expect((await searchCompanies(ACME.member, { segment: "saved" })).companies.map((c) => c.domain)).toEqual([A]);
    // Globex holds nothing: still net new there, and Acme's copy is invisible to it.
    const globexView = (await searchCompanies(GLOBEX_OWNER)).companies.find((c) => c.domain === A);
    expect(globexView).toMatchObject({ netNew: true, savedCompanyId: null });
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/accounts/${companyId}`)).status()).toBe(404);
  });

  test("saving people creates contacts with the published address and provenance, deduped, Acme only", async () => {
    const acme = await apiAsRole("member");
    const res = await acme.post("/api/v1/index/people/save", { data: { ids: [ids.maya, ids.gone] } });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.saved).toHaveLength(1);
    expect(body.skipped).toEqual([{ indexId: ids.gone, reason: "gone" }]);
    const contactId = body.saved[0].id as string;
    const [contact] = await q<{
      first_name: string;
      last_name: string;
      email: string;
      title: string;
      seniority: string;
      source: string;
      company_id: string;
    }>("select first_name, last_name, email, title, seniority, source, company_id from contact where id = $1", [
      contactId,
    ]);
    expect(contact).toMatchObject({
      first_name: "Maya",
      last_name: "Chen",
      email: `maya.chen@${A}`,
      title: "Chief Executive Officer",
      seniority: "c_suite",
      source: "discovery_index",
    });
    const [company] = await q<{ domain: string }>("select domain from company where id = $1", [contact?.company_id]);
    expect(company?.domain).toBe(A);
    const provenance = await q<{ field: string; source: string; source_url: string }>(
      "select field, source, source_url from field_provenance where entity_id = $1",
      [contactId],
    );
    expect(provenance.map((p) => p.field)).toEqual(expect.arrayContaining(["firstName", "lastName", "email", "title"]));
    expect(provenance.every((p) => p.source === "discovery_index" && p.source_url === `https://${A}/team`)).toBe(true);

    const again = await acme.post("/api/v1/index/people/save", { data: { ids: [ids.maya] } });
    expect((await again.json()).existing).toEqual([{ indexId: ids.maya, id: contactId }]);

    const acmeMaya = (await searchPeople(ACME.member)).people.find((p) => p.name === "Maya Chen");
    expect(acmeMaya).toMatchObject({ netNew: false, savedContactId: contactId });
    const counts = (await searchPeople(ACME.member, { includeCounts: true })).counts;
    expect(counts?.saved).toBe(1);
    const globexMaya = (await searchPeople(GLOBEX_OWNER)).people.find((p) => p.name === "Maya Chen");
    expect(globexMaya).toMatchObject({ netNew: true, savedContactId: null });
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/contacts/${contactId}`)).status()).toBe(404);
    // Workspace data never flows back into the index.
    const [indexMaya] = await q<{ n: number }>(
      "select count(*)::int as n from index_person where full_name = 'Maya Chen' and company_id = $1",
      [ids.a],
    );
    expect(indexMaya?.n).toBe(1);
  });

  test("a do-not-contact domain is skipped when saving", async () => {
    const acme = await apiAsRole("member");
    const add = await acme.post("/api/v1/suppressions", { data: { value: B, kind: "domain" } });
    expect([200, 201]).toContain(add.status());
    try {
      const res = await acme.post("/api/v1/index/people/save", { data: { ids: [ids.ida] } });
      expect((await res.json()).skipped).toEqual([{ indexId: ids.ida, reason: "suppressed" }]);
    } finally {
      await q("delete from suppression where value = $1", [B]);
    }
  });

  test("Access email saves the person and runs the workspace's own email finding", async () => {
    test.setTimeout(60_000);
    const viewer = await apiAsRole("viewer");
    expect((await viewer.post("/api/v1/index/people/access_email", { data: { id: ids.ida } })).status()).toBe(403);
    const member = await apiAsRole("member");
    const res = await member.post("/api/v1/index/people/access_email", { data: { id: ids.ida } });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.contactId).toBeTruthy();
    expect(body.person.emailCandidates[0]).toBe(`ida.weiss@${B}`);
    const [contact] = await q<{ source: string }>("select source from contact where id = $1", [body.contactId]);
    expect(contact?.source).toBe("discovery_index");
    // A second call reuses the saved contact.
    const again = await member.post("/api/v1/index/people/access_email", { data: { id: ids.ida } });
    expect((await again.json()).contactId).toBe(body.contactId);
  });
});
