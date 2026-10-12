import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { orgId, pg, uniq } from "./_engage";
import { insertBounce, insertCompany, insertCrawl, insertPerson } from "./_wp-e-enrichment";

/** Data health center: enrichable data counts, activity and job-change hints, per workspace. */

test.describe.configure({ timeout: 120_000 });

interface Card {
  segment: string;
  count: number;
  total: number;
}

interface Change {
  contactId: string;
  signal: string;
  reason: string;
}

test.describe("data health: role matrix", () => {
  test("GET /data_health and /data_health/job_changes", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const health = await api.get("/api/v1/data_health");
      expect(health.status(), role).toBe(expected(role, "contact:read"));
      const changes = await api.get("/api/v1/data_health/job_changes");
      expect(changes.status(), role).toBe(expected(role, "contact:read"));
    }
  });

  test("unauthenticated requests get 401", async () => {
    const anon = await anonymous();
    expect((await anon.get("/api/v1/data_health")).status()).toBe(401);
    expect((await anon.get("/api/v1/data_health/job_changes")).status()).toBe(401);
  });
});

test.describe("data health: behaviour", () => {
  test("cards count the workspace's own records only", async () => {
    await insertPerson("acme", { firstName: "No", lastName: `Email ${uniq()}` });
    const acme = await (await (await apiAsRole("viewer")).get("/api/v1/data_health")).json();
    const card = (acme.data_health.cards as Card[]).find((c) => c.segment === "missing_email");
    const { rows } = await pg().query<{ n: number }>(
      "select count(*)::int n from contact where organization_id = $1 and email is null",
      [await orgId("acme")],
    );
    expect(card?.count).toBe(rows[0]?.n);
    const companies = await pg().query<{ n: number }>(
      "select count(*)::int n from company where organization_id = $1",
      [await orgId("acme")],
    );
    expect(acme.data_health.companies).toBe(companies.rows[0]?.n);
    expect(acme.data_health.activity.days).toHaveLength(30);
    expect(typeof acme.data_health.activity.lookups).toBe("number");
    expect(typeof acme.data_health.activity.cacheHits).toBe("number");

    const globex = await (await (await apiAs(GLOBEX_OWNER)).get("/api/v1/data_health")).json();
    const g = await pg().query<{ n: number }>("select count(*)::int n from contact where organization_id = $1", [
      await orgId("globex"),
    ]);
    expect(globex.data_health.contacts).toBe(g.rows[0]?.n);
  });

  test("job changes: bounced address, and a name missing from the team page", async () => {
    const tag = uniq("jc");
    const companyId = await insertCompany("acme", { name: `Team Co ${tag}` });
    const left = await insertPerson("acme", { firstName: "Left", lastName: tag, companyId, createdDaysAgo: 10 });
    const stays = await insertPerson("acme", { firstName: "Stays", lastName: tag, companyId, createdDaysAgo: 10 });
    const never = await insertPerson("acme", { firstName: "Never", lastName: tag, companyId, createdDaysAgo: 10 });
    await insertCrawl(
      "acme",
      companyId,
      [
        { firstName: "Left", lastName: tag },
        { firstName: "Stays", lastName: tag },
      ],
      5,
    );
    await insertCrawl("acme", companyId, [{ firstName: "Stays", lastName: tag }], 1);
    const email = `${tag}@bounce.example.test`;
    const bounced = await insertPerson("acme", { firstName: "Bounced", lastName: tag, email });
    await insertBounce("acme", bounced, email);

    const api = await apiAsRole("member");
    const changes = (await (await api.get("/api/v1/data_health/job_changes")).json()).job_changes as Change[];
    const of = (id: string) => changes.find((c) => c.contactId === id);
    expect(of(left)?.signal).toBe("strong");
    expect(of(never)?.signal).toBe("hint");
    expect(of(stays)).toBeUndefined();
    expect(of(bounced)?.reason).toContain("bounced");

    // Marking one as changed job goes through the contacts API and drops it from the list.
    const mark = await api.patch(`/api/v1/contacts/${left}`, { data: { stage: "changed_job" } });
    expect(mark.status()).toBe(200);
    const after = (await (await api.get("/api/v1/data_health/job_changes")).json()).job_changes as Change[];
    expect(after.some((c) => c.contactId === left)).toBe(false);

    const globex = (await (await (await apiAs(GLOBEX_OWNER)).get("/api/v1/data_health/job_changes")).json())
      .job_changes as Change[];
    const ours: string[] = [left, never, bounced];
    expect(globex.some((c) => ours.includes(c.contactId))).toBe(false);
  });
});
