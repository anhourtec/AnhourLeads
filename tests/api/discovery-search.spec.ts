import { expect, test } from "@playwright/test";

import {
  cleanSearchIndex,
  closeDiscoDb,
  type SearchIndexFixture,
  seedSearchIndex,
} from "../support/discovery-fixtures";
import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAs, apiAsRole, apiWithKey, GLOBEX_OWNER } from "../support/session";
import { closeDb, createApiKey } from "./white-label-helpers";

/**
 * The index search as Find people / Find companies use it (Total / Net new / Saved tabs): the
 * filter keys mapped from the shared search filters (name, company names, location exclude,
 * company location, keyword exclude, unknown size), the one-query Total / Net new / Saved counts,
 * roles, API keys, isolation of the saved flags between workspaces, and validation.
 */

const TAG = `ds${Date.now().toString(36)}`;
let fx: SearchIndexFixture;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fx = await seedSearchIndex(TAG);
});

test.afterAll(async () => {
  await cleanSearchIndex(TAG);
  await closeDiscoDb();
  await closeDb();
});

interface PeopleResponse {
  people: { id: string; name: string; netNew: boolean; savedContactId: string | null }[];
  pagination: { total_entries: number };
  counts?: { total: number; net_new: number; saved: number };
}

interface CompaniesResponse {
  companies: { id: string; domain: string; netNew: boolean; savedCompanyId: string | null }[];
  pagination: { total_entries: number };
  counts?: { total: number; net_new: number; saved: number };
}

async function people(email: string, body: Record<string, unknown> = {}): Promise<PeopleResponse> {
  const api = await apiAs(email);
  const res = await api.post("/api/v1/index/people/search", {
    data: { domains: fx.domains, per_page: 50, includeCounts: true, ...body },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as PeopleResponse;
}

async function companies(email: string, body: Record<string, unknown> = {}): Promise<CompaniesResponse> {
  const api = await apiAs(email);
  const res = await api.post("/api/v1/index/companies/search", {
    data: { domains: fx.domains, per_page: 50, includeCounts: true, ...body },
  });
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()) as CompaniesResponse;
}

const firstNames = (r: PeopleResponse) => r.people.map((p) => p.name.split(" ")[0]).sort();

test.describe("index search for the find screens: roles and validation", () => {
  for (const role of ROLES) {
    test(`${role}: search with counts follows search:run, saving follows the matrix`, async () => {
      const api = await apiAsRole(role);
      const search = await api.post("/api/v1/index/people/search", {
        data: { domains: fx.domains, includeCounts: true, name: "nora" },
      });
      expect(search.status()).toBe(expected(role, "search:run"));
      if (search.status() === 200) {
        const body = (await search.json()) as PeopleResponse;
        expect(body.counts?.total).toBe(1);
      }
      const co = await api.post("/api/v1/index/companies/search", {
        data: { domains: fx.domains, includeCounts: true, companies: ["lumen"] },
      });
      expect(co.status()).toBe(expected(role, "search:run"));
      expect((await api.get(`/api/v1/index/companies/${fx.companies.quarry}`)).status()).toBe(
        expected(role, "search:run"),
      );
      expect((await api.post("/api/v1/index/people/save", { data: { ids: ["missing"] } })).status()).toBe(
        expected(role, "contact:create"),
      );
      expect((await api.post("/api/v1/index/companies/save", { data: { ids: ["missing"] } })).status()).toBe(
        expected(role, "company:create"),
      );
    });
  }

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    expect((await api.post("/api/v1/index/people/search", { data: { name: "nora" } })).status()).toBe(401);
    expect((await api.post("/api/v1/index/companies/search", { data: { companies: ["x"] } })).status()).toBe(401);
  });

  test("API keys search with their own role", async () => {
    const { secret, remove } = await createApiKey(ACME.owner, "viewer");
    try {
      const api = await apiWithKey(secret);
      const res = await api.post("/api/v1/index/people/search", {
        data: { domains: fx.domains, includeCounts: true, companyLocation: ["canada"] },
      });
      expect(res.status()).toBe(200);
      expect(((await res.json()) as PeopleResponse).counts?.total).toBe(2);
      expect((await api.post("/api/v1/index/people/save", { data: { ids: [fx.people.nora] } })).status()).toBe(403);
    } finally {
      await remove();
    }
  });

  test("invalid values for the new filter keys get 422", async () => {
    const api = await apiAsRole("member");
    for (const data of [
      { name: "x".repeat(201) },
      { companies: Array.from({ length: 51 }, (_, i) => `c${i}`) },
      { employeesUnknown: "maybe" },
      { keywordsExclude: [{}] },
    ]) {
      expect((await api.post("/api/v1/index/people/search", { data })).status(), JSON.stringify(data)).toBe(422);
    }
    expect((await api.post("/api/v1/index/companies/search", { data: { name: "nora" } })).status()).toBe(422);
    expect((await api.post("/api/v1/index/companies/search", { data: { titles: ["ceo"] } })).status()).toBe(422);
  });
});

test.describe("index search for the find screens: filters", () => {
  test("people: name, company names, location exclude, company location, keyword exclude", async () => {
    expect(firstNames(await people(ACME.member))).toEqual(["Nora", "Omar", "Pia", "Quinn"]);
    expect(firstNames(await people(ACME.member, { name: "omar" }))).toEqual(["Omar"]);
    expect(firstNames(await people(ACME.member, { companies: ["quarry"] }))).toEqual(["Pia"]);
    expect(firstNames(await people(ACME.member, { companiesExclude: ["lumen", "nosize"] }))).toEqual(["Pia"]);
    expect(firstNames(await people(ACME.member, { locationExclude: ["canada", "france"] }))).toEqual(["Pia"]);
    expect(firstNames(await people(ACME.member, { companyLocation: ["vancouver"] }))).toEqual(["Nora", "Omar"]);
    expect(firstNames(await people(ACME.member, { keywordsExclude: ["robotics"] }))).toEqual(["Pia", "Quinn"]);
  });

  test("companies: size ranges, min/max and unknown size combine like workspace search", async () => {
    const domains = async (body: Record<string, unknown>) =>
      (await companies(ACME.member, body)).companies.map((c) => c.domain.split(".")[0]).sort();
    expect(await domains({ employeeRanges: ["51-100"] })).toEqual(["lumen"]);
    expect(await domains({ employeesUnknown: true })).toEqual(["nosize"]);
    // Ranges, the min/max window and unknown size are alternatives ("or"), as in workspace search.
    expect(await domains({ employeeRanges: ["51-100"], employeesUnknown: true })).toEqual(["lumen", "nosize"]);
    expect(await domains({ employeesMin: 500, employeesUnknown: true })).toEqual(["nosize", "quarry"]);
    expect(await domains({ keywordsExclude: ["analytics"] })).toEqual(["lumen", "nosize"]);
  });
});

test.describe("index search for the find screens: Total / Net new / Saved counts", () => {
  test("saving flips counts for that workspace only", async () => {
    const before = await people(ACME.member);
    expect(before.counts).toEqual({ total: 4, net_new: 4, saved: 0 });
    expect((await companies(ACME.member)).counts).toEqual({ total: 3, net_new: 3, saved: 0 });

    const member = await apiAsRole("member");
    const saved = await member.post("/api/v1/index/people/save", { data: { ids: [fx.people.omar] } });
    expect(saved.status(), await saved.text()).toBe(200);
    const contactId = ((await saved.json()) as { saved: { id: string }[] }).saved[0]?.id;
    expect(contactId).toBeTruthy();

    // Acme: Omar is saved (and Lumen, created with him); the segment filters agree with the counts.
    const after = await people(ACME.member);
    expect(after.counts).toEqual({ total: 4, net_new: 3, saved: 1 });
    expect(after.people.find((p) => p.id === fx.people.omar)).toMatchObject({
      netNew: false,
      savedContactId: contactId,
    });
    expect(firstNames(await people(ACME.member, { segment: "net_new" }))).toEqual(["Nora", "Pia", "Quinn"]);
    expect(firstNames(await people(ACME.member, { segment: "saved" }))).toEqual(["Omar"]);
    // Counts ignore the segment itself.
    expect((await people(ACME.member, { segment: "net_new" })).counts).toEqual(after.counts);
    expect((await companies(ACME.member)).counts).toEqual({ total: 3, net_new: 2, saved: 1 });

    // Globex holds nothing: everything is still net new there, and Acme's contact is invisible.
    expect((await people(GLOBEX_OWNER)).counts).toEqual({ total: 4, net_new: 4, saved: 0 });
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/contacts/${contactId}`)).status()).toBe(404);
  });
});
