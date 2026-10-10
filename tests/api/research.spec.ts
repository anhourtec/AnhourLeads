import { type APIRequestContext, expect, test } from "@playwright/test";

import { type FixtureServer, requestLog, startFixtureServer } from "../support/fixture-server";
import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";

/**
 * Research: crawler, email verification, people match and organization enrichment.
 * The crawler runs against the local fixture site (tests/fixtures/site on 127.0.0.1:48090);
 * the dev server allows private hosts (CRAWLER_ALLOW_PRIVATE_HOSTS=true), production never does.
 */

interface PageRow {
  url: string;
  statusCode: number | null;
  skippedReason: string | null;
}

let fixture: FixtureServer;
let completedJobId = "";

async function waitForJob(api: APIRequestContext, id: string, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const res = await api.get(`/api/v1/crawl_jobs/${id}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    if (body.crawl_job.status === "completed" || body.crawl_job.status === "failed") return body;
    if (Date.now() > until) throw new Error(`crawl job ${id} still ${body.crawl_job.status}`);
    await new Promise((r) => setTimeout(r, 750));
  }
}

test.beforeAll(async () => {
  fixture = await startFixtureServer();
});

test.afterAll(async () => {
  await fixture.close();
});

test.describe("research: crawler", () => {
  test("crawls the fixture politely: robots, same-site only, size and type limits", async () => {
    test.setTimeout(120_000);
    const api = await apiAsRole("member");
    const created = await api.post("/api/v1/crawl_jobs", { data: { url: `${fixture.url}/`, maxPages: 12 } });
    expect(created.status()).toBe(201);
    const { crawl_job } = await created.json();
    expect(crawl_job.status).toBe("queued");
    expect(crawl_job.seedUrl).toBe(`${fixture.url}/`);

    const detail = await waitForJob(api, crawl_job.id);
    expect(detail.crawl_job.status).toBe("completed");
    completedJobId = crawl_job.id;
    const pages = detail.pages as PageRow[];
    const byUrl = (suffix: string) => pages.find((p) => p.url === `${fixture.url}${suffix}`);

    // robots.txt disallows /private: recorded as skipped, never fetched.
    expect(byUrl("/private/admin.html")?.skippedReason).toBe("robots");
    if (fixture.started) expect(requestLog.some((r) => r.path.startsWith("/private"))).toBe(false);
    if (fixture.started) {
      expect(requestLog.some((r) => r.path === "/robots.txt" && r.userAgent.startsWith("AnhourLeadsBot"))).toBe(true);
    }

    // Offsite links and offsite redirects are never followed.
    expect(pages.find((p) => p.url.startsWith("http://offsite.example"))?.skippedReason).toBe("offsite");
    expect(byUrl("/redirect-away")?.skippedReason).toBe("offsite");
    for (const page of pages.filter((p) => !p.skippedReason)) expect(page.url.startsWith(fixture.url)).toBe(true);

    // Limits: > 1 MB, non-HTML by extension and by content type.
    expect(byUrl("/large.html")?.skippedReason).toBe("too_large");
    expect(byUrl("/brochure.pdf")?.skippedReason).toBe("not_html");
    expect(byUrl("/status")?.skippedReason).toBe("not_html");

    // Key pages fetched.
    for (const path of ["/", "/about", "/team", "/contact", "/careers"]) {
      expect(byUrl(path)?.statusCode, path).toBe(200);
      expect(byUrl(path)?.skippedReason, path).toBeNull();
    }
    expect(detail.crawl_job.pagesCrawled).toBeLessThanOrEqual(12);

    const findings = detail.findings;
    expect(findings.robots.status).toBe("found");
    const emails = findings.emails.map((e: { email: string }) => e.email);
    expect(emails).toContain("jane.doe@fixture-acme.test");
    expect(emails).toContain("sales@fixture-acme.test");
    expect(emails).not.toContain("secret-admin@fixture-acme.test");
    for (const e of findings.emails) expect(typeof e.status).toBe("string");

    const people = findings.people.map((p: { name: string; title: string }) => `${p.name}|${p.title}`);
    expect(people).toContain("Jane Doe|Chief Executive Officer");
    expect(people).toContain("John Smith|Chief Technology Officer");
    expect(people).toContain("Maria Garcia|Head of Sales");
    expect(people.some((p: string) => p.startsWith("Our Values"))).toBe(false);

    const tech = findings.technologies.map((t: { name: string }) => t.name);
    expect(tech).toEqual(expect.arrayContaining(["WordPress", "Stripe", "Google Analytics", "Next.js"]));
    const social = findings.social.map((s: { url: string }) => s.url);
    expect(social).toEqual(
      expect.arrayContaining(["https://www.linkedin.com/company/fixture-acme", "https://x.com/fixtureacme"]),
    );
    expect(social.some((s: string) => s.includes("intent"))).toBe(false);
    expect(findings.hiring.jobCount).toBe(3);
    expect(findings.hiring.ats).toContain("Greenhouse");
    expect(
      findings.facts.some((f: { field: string; value: string }) => f.field === "foundedYear" && f.value === "2015"),
    ).toBe(true);
  });

  test("apply findings writes the company with provenance and creates deduped contacts", async () => {
    test.skip(!completedJobId, "needs the crawl above");
    const api = await apiAsRole("member");
    const first = await api.post(`/api/v1/crawl_jobs/${completedJobId}/apply`, { data: { createContacts: true } });
    expect(first.status()).toBe(200);
    const applied = await first.json();
    expect(applied.company.id).toBeTruthy();
    const fieldNames = applied.fields.map((f: { field: string }) => f.field);
    expect(fieldNames).toEqual(expect.arrayContaining(["linkedinUrl", "technologies", "foundedYear"]));
    for (const f of applied.fields) {
      expect(f.source).toBe("crawler");
      if (f.action !== "kept_existing") expect(f.sourceUrl).toContain(fixture.url);
    }
    const names = applied.contacts.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Jane Doe", "John Smith", "Maria Garcia"]));

    // Applying again never duplicates contacts.
    const again = await (
      await api.post(`/api/v1/crawl_jobs/${completedJobId}/apply`, { data: { createContacts: true } })
    ).json();
    for (const c of again.contacts) expect(c.status).not.toBe("created");

    // Provenance is visible through organization enrichment (reusing the completed crawl).
    const enriched = await api.post("/api/v1/organizations/enrich", {
      data: { companyId: applied.company.id, website: `${fixture.url}/` },
    });
    expect(enriched.status()).toBe(200);
    const org = await enriched.json();
    expect(org.cached).toBe(true);
    expect(org.credits.consumed).toBe(0);
    const linkedin = org.provenance.find((p: { field: string }) => p.field === "linkedinUrl");
    expect(linkedin?.source).toBe("crawler");
    expect(linkedin?.sourceUrl).toContain(fixture.url);
    expect(org.organization.technologies).toEqual(expect.arrayContaining(["WordPress"]));

    // A crawl job can target the company directly.
    const byCompany = await api.post("/api/v1/crawl_jobs", { data: { companyId: applied.company.id, maxPages: 1 } });
    expect(byCompany.status()).toBe(201);
    expect((await byCompany.json()).crawl_job.companyId).toBe(applied.company.id);
  });
});

test.describe("research: roles, isolation, validation", () => {
  test("crawl_jobs endpoints follow the permission matrix", async () => {
    test.setTimeout(120_000);
    const owner = await apiAsRole("owner");
    let jobId = completedJobId;
    if (!jobId) {
      const res = await owner.post("/api/v1/crawl_jobs", { data: { url: `${fixture.url}/`, maxPages: 2 } });
      jobId = (await res.json()).crawl_job.id;
      await waitForJob(owner, jobId);
    }
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const create = await api.post("/api/v1/crawl_jobs", { data: { url: `${fixture.url}/about`, maxPages: 1 } });
      expect(create.status(), `${role} create`).toBe(expected(role, "crawler:run", 201));
      expect((await api.get("/api/v1/crawl_jobs")).status(), `${role} list`).toBe(expected(role, "crawler:read"));
      expect((await api.get(`/api/v1/crawl_jobs/${jobId}`)).status(), `${role} read`).toBe(
        expected(role, "crawler:read"),
      );
      const apply = await api.post(`/api/v1/crawl_jobs/${jobId}/apply`, { data: {} });
      expect(apply.status(), `${role} apply`).toBe(expected(role, "company:update"));
    }
  });

  test("enrichment endpoints follow the permission matrix", async () => {
    test.setTimeout(120_000);
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const want = expected(role, "enrich:run");
      expect(
        (await api.post("/api/v1/email_verifications", { data: { email: "not-an-email" } })).status(),
        `${role} verify`,
      ).toBe(want);
      expect(
        (await api.post("/api/v1/people/match", { data: { email: "someone@nomx.invalid", verify: false } })).status(),
        `${role} match`,
      ).toBe(want);
      expect(
        (
          await api.post("/api/v1/people/bulk_match", {
            data: { details: [{ email: "someone@nomx.invalid" }], verify: false },
          })
        ).status(),
        `${role} bulk match`,
      ).toBe(want);
      expect(
        (await api.get(`/api/v1/organizations/enrich?website=${encodeURIComponent(`${fixture.url}/`)}`)).status(),
        `${role} enrich`,
      ).toBe(want);
      expect(
        (
          await api.post("/api/v1/organizations/bulk_enrich", { data: { details: [{ website: `${fixture.url}/` }] } })
        ).status(),
        `${role} bulk enrich`,
      ).toBe(want);
    }
  });

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    const id = completedJobId || "missing";
    expect((await api.get("/api/v1/crawl_jobs")).status()).toBe(401);
    expect((await api.post("/api/v1/crawl_jobs", { data: { url: "https://acme.com" } })).status()).toBe(401);
    expect((await api.get(`/api/v1/crawl_jobs/${id}`)).status()).toBe(401);
    expect((await api.post(`/api/v1/crawl_jobs/${id}/apply`, { data: {} })).status()).toBe(401);
    expect((await api.post("/api/v1/email_verifications", { data: { email: "a@b.co" } })).status()).toBe(401);
    expect((await api.post("/api/v1/people/match", { data: { email: "a@b.co" } })).status()).toBe(401);
    expect((await api.post("/api/v1/people/bulk_match", { data: { details: [] } })).status()).toBe(401);
    expect((await api.get("/api/v1/organizations/enrich?domain=acme.com")).status()).toBe(401);
    expect((await api.post("/api/v1/organizations/bulk_enrich", { data: { domains: ["acme.com"] } })).status()).toBe(
      401,
    );
  });

  test("Globex can't see or touch Acme's crawl jobs", async () => {
    const acme = await apiAsRole("member");
    const globex = await apiAs(GLOBEX_OWNER);
    const created = await acme.post("/api/v1/crawl_jobs", { data: { url: `${fixture.url}/about`, maxPages: 1 } });
    const acmeId = (await created.json()).crawl_job.id as string;
    expect((await globex.get(`/api/v1/crawl_jobs/${acmeId}`)).status()).toBe(404);
    expect((await globex.post(`/api/v1/crawl_jobs/${acmeId}/apply`, { data: {} })).status()).toBe(404);
    const list = await (await globex.get("/api/v1/crawl_jobs?per_page=100")).json();
    expect(list.crawl_jobs.some((j: { id: string }) => j.id === acmeId)).toBe(false);
    if (completedJobId) expect(list.crawl_jobs.some((j: { id: string }) => j.id === completedJobId)).toBe(false);
  });

  test("invalid input gets 422", async () => {
    const api = await apiAsRole("member");
    expect((await api.post("/api/v1/crawl_jobs", { data: {} })).status()).toBe(422);
    expect((await api.post("/api/v1/crawl_jobs", { data: { url: "ftp://acme.com/" } })).status()).toBe(422);
    expect((await api.post("/api/v1/crawl_jobs", { data: { url: "https://acme.com", maxPages: 26 } })).status()).toBe(
      422,
    );
    expect((await api.post("/api/v1/crawl_jobs", { data: { url: "not a url at all" } })).status()).toBe(422);
    expect((await api.post("/api/v1/email_verifications", { data: {} })).status()).toBe(422);
    expect(
      (await api.post("/api/v1/email_verifications", { data: { email: "a@b.co", contactId: "x" } })).status(),
    ).toBe(422);
    expect((await api.post("/api/v1/people/match", { data: {} })).status()).toBe(422);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ email: `p${i}@nomx.invalid` }));
    expect((await api.post("/api/v1/people/bulk_match", { data: { details: eleven } })).status()).toBe(422);
    const domains = Array.from({ length: 11 }, (_, i) => `d${i}.example.com`);
    expect((await api.post("/api/v1/organizations/bulk_enrich", { data: { domains } })).status()).toBe(422);
    expect((await api.get("/api/v1/organizations/enrich")).status()).toBe(422);
    expect((await api.get("/api/v1/crawl_jobs?status=bogus")).status()).toBe(422);
  });

  test("unknown ids get 404", async () => {
    const api = await apiAsRole("member");
    expect((await api.get("/api/v1/crawl_jobs/does-not-exist")).status()).toBe(404);
    expect((await api.post("/api/v1/crawl_jobs", { data: { companyId: "does-not-exist" } })).status()).toBe(404);
    expect((await api.post("/api/v1/email_verifications", { data: { contactId: "does-not-exist" } })).status()).toBe(
      404,
    );
    expect((await api.post("/api/v1/people/match", { data: { contactId: "does-not-exist" } })).status()).toBe(404);
  });

  test("cross-site cookie writes are refused", async () => {
    const api = await apiAsRole("member");
    const evil = { origin: "https://evil.example" };
    expect(
      (await api.post(`${BASE_URL}/api/v1/crawl_jobs`, { headers: evil, data: { url: "https://acme.com" } })).status(),
    ).toBe(403);
    expect(
      (await api.post(`${BASE_URL}/api/v1/email_verifications`, { headers: evil, data: { email: "a@b.co" } })).status(),
    ).toBe(403);
    expect(
      (await api.post(`${BASE_URL}/api/v1/people/match`, { headers: evil, data: { email: "a@b.co" } })).status(),
    ).toBe(403);
  });
});

test.describe("research: email verification", () => {
  async function verify(email: string) {
    const api = await apiAsRole("member");
    const res = await api.post("/api/v1/email_verifications", { data: { email } });
    expect(res.status()).toBe(200);
    return (await res.json()).verification;
  }

  test("bad syntax is invalid", async () => {
    const v = await verify("not-an-email");
    expect(v.status).toBe("invalid");
    expect(v.reason).toMatch(/^syntax/);
  });

  test("disposable domain is disposable", async () => {
    expect((await verify(`someone${Date.now()}@mailinator.com`)).status).toBe("disposable");
  });

  test("role address is role", async () => {
    expect((await verify("info@gmail.com")).status).toBe("role");
  });

  test("domain without mail hosts is invalid", async () => {
    const v = await verify(`jane${Date.now()}@nomx.invalid`);
    expect(v.status).toBe("invalid");
    expect(v.reason).toBe("no_mail_host");
  });

  test("results are cached: the second lookup is free", async () => {
    const email = `cache-check-${Date.now()}@gmail.com`;
    const first = await verify(email);
    expect(first.cached).toBe(false);
    expect(first.status).toBe("unknown");
    expect(first.checks.mx.length).toBeGreaterThan(0);
    const second = await verify(email);
    expect(second.cached).toBe(true);
    expect(second.status).toBe(first.status);
    expect(second.credits.lookups[0].cached).toBe(true);
    expect(second.credits.consumed).toBe(0);
  });

  test("people match guesses from a name and domain and reports the cost", async () => {
    const api = await apiAsRole("member");
    const res = await api.post("/api/v1/people/match", {
      data: { firstName: "Ada", lastName: "Lovelace", domain: "gmail.com" },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.person.emailCandidates[0]).toBe("ada.lovelace@gmail.com");
    expect(body.person.email).toBe("ada.lovelace@gmail.com");
    expect(body.person.emailSource).toBe("pattern");
    expect(body.credits.consumed).toBe(0);
    expect(body.credits.lookups.some((l: { type: string }) => l.type === "email_verification")).toBe(true);

    const none = await (
      await api.post("/api/v1/people/match", {
        data: { firstName: "Ada", lastName: "Lovelace", domain: "nomx.invalid" },
      })
    ).json();
    expect(none.person.email).toBeNull();
  });
});
