import { expect, test } from "@playwright/test";

import { can } from "../../src/lib/rbac/permissions";
import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAsRole, apiWithKey } from "../support/session";
import {
  acmeKeyClient,
  acmeOrgId,
  db,
  EVIL_ORIGIN,
  freshWorkspace,
  globexApi,
  globexKey,
  insertContact,
  orgIdOf,
  uniq,
  userIdOf,
} from "./admin-helpers";

// The dev server compiles routes on first hit; signing in five roles can take a while.
test.describe.configure({ timeout: 120_000 });

interface SearchBody {
  people: { id: string; name: string; title: string | null; company: string | null; stage: string }[];
  companies: { id: string; name: string; employeeCount: number | null; industry: string | null; stage: string }[];
  settings: { id: string; title: string; section: string; url: string }[];
}

async function insertNotification(organizationId: string, userId: string, title = uniq("Note")): Promise<string> {
  const id = crypto.randomUUID();
  await db().query(
    `insert into notification (id, organization_id, user_id, type, title, body, link)
     values ($1, $2, $3, 'test', $4, 'Body', '/dashboard/home')`,
    [id, organizationId, userId, title],
  );
  return id;
}

async function insertActivity(organizationId: string, summary: string): Promise<string> {
  const id = crypto.randomUUID();
  await db().query(`insert into activity (id, organization_id, type, summary) values ($1, $2, 'note_added', $3)`, [
    id,
    organizationId,
    summary,
  ]);
  return id;
}

test.describe("global search API", () => {
  test("every role per the matrix; 401 signed out; API keys work", async () => {
    const org = await acmeOrgId();
    const name = uniq("Zebulon");
    await insertContact(org, { firstName: name, lastName: "Searchable", email: `${name}@search.example` });
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get(`/api/v1/search?q=${encodeURIComponent(name)}`);
      expect(res.status(), role).toBe(expected(role, "search:run"));
      const body = (await res.json()) as SearchBody;
      expect(body.people.map((p) => p.name)).toContain(`${name} Searchable`);
      expect(body.people.length).toBeLessThanOrEqual(5);
    }
    expect((await (await anonymous()).get("/api/v1/search?q=a")).status()).toBe(401);
    expect((await (await acmeKeyClient("viewer")).get(`/api/v1/search?q=${name}`)).status()).toBe(200);
  });

  test("validation: empty or overlong query is 422", async () => {
    const owner = await apiAsRole("owner");
    expect((await owner.get("/api/v1/search")).status()).toBe(422);
    expect((await owner.get("/api/v1/search?q=%20%20")).status()).toBe(422);
    expect((await owner.get(`/api/v1/search?q=${"x".repeat(101)}`)).status()).toBe(422);
  });

  test("companies come back with their fields, at most five per group", async () => {
    const owner = await apiAsRole("owner");
    const res = await owner.get("/api/v1/search?q=a");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as SearchBody;
    expect(body.companies.length).toBeGreaterThan(0);
    expect(body.companies.length).toBeLessThanOrEqual(5);
    expect(Object.keys(body.companies[0]).sort()).toEqual(["employeeCount", "id", "industry", "name", "stage"]);
  });

  test("workspace isolation: Globex can't find Acme's people or companies", async () => {
    const org = await acmeOrgId();
    const name = uniq("Isolde");
    await insertContact(org, { firstName: name, lastName: "Acmeonly" });
    const acme = (await (await (await apiAsRole("owner")).get(`/api/v1/search?q=${name}`)).json()) as SearchBody;
    expect(acme.people.length).toBe(1);

    for (const client of [await globexApi(), await apiWithKey((await globexKey()).secret)]) {
      const res = await client.get(`/api/v1/search?q=${name}`);
      expect(res.status()).toBe(200);
      expect(((await res.json()) as SearchBody).people).toEqual([]);
      const companies = (await (await client.get("/api/v1/search?q=Acme%20Prospecting")).json()) as SearchBody;
      expect(companies.people).toEqual([]);
    }
    // Globex's own company is found by Globex and never by Acme.
    const globex = (await (await (await globexApi()).get("/api/v1/search?q=Globex%20Secret")).json()) as SearchBody;
    expect(globex.companies.map((c) => c.name)).toContain("Globex Secret Prospect");
    const acmeSees = (await (
      await (await apiAsRole("owner")).get("/api/v1/search?q=Globex%20Secret")
    ).json()) as SearchBody;
    expect(acmeSees.companies).toEqual([]);
  });

  test("settings results respect the caller's permissions", async () => {
    for (const role of ROLES) {
      const keys = (await (await (await apiAsRole(role)).get("/api/v1/search?q=api%20keys")).json()) as SearchBody;
      expect(
        keys.settings.some((s) => s.id === "api-keys"),
        role,
      ).toBe(can(role, "apikey:read"));
      const audit = (await (await (await apiAsRole(role)).get("/api/v1/search?q=audit")).json()) as SearchBody;
      expect(
        audit.settings.some((s) => s.id === "audit-log"),
        role,
      ).toBe(can(role, "audit:read"));
      const profile = (await (await (await apiAsRole(role)).get("/api/v1/search?q=profile")).json()) as SearchBody;
      expect(profile.settings.find((s) => s.id === "profile")?.url, role).toBe("/dashboard/settings/profile");
    }
  });
});

test.describe("notifications API", () => {
  test("each person sees only their own notifications; 401 signed out", async () => {
    const org = await acmeOrgId();
    const memberId = await userIdOf(ACME.member);
    const title = uniq("For member");
    await insertNotification(org, memberId, title);

    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/notifications");
      expect(res.status(), role).toBe(200);
      const body = (await res.json()) as { notifications: { title: string }[]; unread: number };
      expect(
        body.notifications.some((n) => n.title === title),
        role,
      ).toBe(role === "member");
    }
    expect((await (await anonymous()).get("/api/v1/notifications")).status()).toBe(401);
    // Notifications are personal; an API key has no person behind it.
    expect((await (await acmeKeyClient("owner")).get("/api/v1/notifications")).status()).toBe(403);
  });

  test("mark read: own ids and all; another person's id is 404; validation 422; CSRF 403", async () => {
    const org = await acmeOrgId();
    const viewerId = await userIdOf(ACME.viewer);
    const managerId = await userIdOf(ACME.manager);
    const mine = await insertNotification(org, viewerId);
    const other = await insertNotification(org, viewerId);
    const managers = await insertNotification(org, managerId);
    const viewer = await apiAsRole("viewer");

    const before = (await (await viewer.get("/api/v1/notifications")).json()) as { unread: number };
    const read = await viewer.post("/api/v1/notifications/read", { data: { ids: [mine] } });
    expect(read.status()).toBe(200);
    expect((await read.json()).updated).toBe(1);
    const after = (await (await viewer.get("/api/v1/notifications")).json()) as {
      unread: number;
      notifications: { id: string; readAt: string | null }[];
    };
    expect(after.unread).toBe(before.unread - 1);
    expect(after.notifications.find((n) => n.id === mine)?.readAt).not.toBeNull();
    expect(after.notifications.find((n) => n.id === other)?.readAt).toBeNull();

    // Someone else's notification (same workspace) and a Globex user's are both not found.
    expect((await viewer.post("/api/v1/notifications/read", { data: { ids: [managers] } })).status()).toBe(404);
    const globexOrg = await orgIdOf("globex");
    const globexNote = await insertNotification(globexOrg, await userIdOf("owner@globex.test"));
    expect((await viewer.post("/api/v1/notifications/read", { data: { ids: [globexNote] } })).status()).toBe(404);
    expect((await (await globexApi()).post("/api/v1/notifications/read", { data: { ids: [other] } })).status()).toBe(
      404,
    );
    const { rows } = await db().query<{ read_at: Date | null }>("select read_at from notification where id = $1", [
      managers,
    ]);
    expect(rows[0]?.read_at).toBeNull();

    expect((await viewer.post("/api/v1/notifications/read", { data: {} })).status()).toBe(422);
    expect((await viewer.post("/api/v1/notifications/read", { data: { ids: [] } })).status()).toBe(422);
    expect((await viewer.post("/api/v1/notifications/read", { data: { all: false } })).status()).toBe(422);
    expect(
      (await viewer.post("/api/v1/notifications/read", { data: { all: true }, headers: EVIL_ORIGIN })).status(),
    ).toBe(403);

    const all = await viewer.post("/api/v1/notifications/read", { data: { all: true } });
    expect(all.status()).toBe(200);
    expect(((await (await viewer.get("/api/v1/notifications")).json()) as { unread: number }).unread).toBe(0);
    expect((await (await anonymous()).post("/api/v1/notifications/read", { data: { all: true } })).status()).toBe(401);
  });
});

test.describe("activities API", () => {
  test("any member reads their workspace's recent activity, newest first, limited", async () => {
    const acmeOrg = await acmeOrgId();
    const globexOrg = await orgIdOf("globex");
    const acmeSummary = uniq("Acme activity");
    const globexSummary = uniq("Globex activity");
    await insertActivity(acmeOrg, acmeSummary);
    await insertActivity(globexOrg, globexSummary);

    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/activities?limit=20");
      expect(res.status(), role).toBe(200);
      const { activities } = (await res.json()) as { activities: { summary: string; occurredAt: string }[] };
      expect(activities.length).toBeLessThanOrEqual(20);
      expect(activities.map((a) => a.summary)).toContain(acmeSummary);
      expect(activities.map((a) => a.summary)).not.toContain(globexSummary);
    }
    const globex = (await (await (await globexApi()).get("/api/v1/activities")).json()) as {
      activities: { summary: string }[];
    };
    expect(globex.activities.map((a) => a.summary)).toContain(globexSummary);
    expect(globex.activities.map((a) => a.summary)).not.toContain(acmeSummary);

    const limited = (await (await (await apiAsRole("viewer")).get("/api/v1/activities?limit=1")).json()) as {
      activities: unknown[];
    };
    expect(limited.activities.length).toBe(1);
    expect((await (await anonymous()).get("/api/v1/activities")).status()).toBe(401);
    expect((await (await acmeKeyClient("viewer")).get("/api/v1/activities")).status()).toBe(200);
  });
});

test.describe("onboarding API", () => {
  test("a new workspace owner starts onboarding; state is their own and saves", async () => {
    const fresh = await freshWorkspace();
    const start = (await (await fresh.api.get("/api/v1/onboarding")).json()).onboarding;
    expect(start).toMatchObject({ exists: true, finishedAt: null, goals: [], homeLayout: "getting_started" });

    const saved = await fresh.api.patch("/api/v1/onboarding", {
      data: { role: "recruiting", teamSize: "2_10", goals: ["outbound", "deal_execution"] },
    });
    expect(saved.status(), await saved.text()).toBe(200);
    expect((await saved.json()).onboarding).toMatchObject({
      role: "recruiting",
      teamSize: "2_10",
      goals: ["outbound", "deal_execution"],
      finishedAt: null,
    });

    const done = await fresh.api.patch("/api/v1/onboarding", {
      data: { antiSpamAccepted: true, finished: true, outcome: "email_skipped" },
    });
    const finished = (await done.json()).onboarding;
    expect(finished.finishedAt).not.toBeNull();
    expect(finished.antiSpamAcceptedAt).not.toBeNull();
    expect(finished.completedSteps).toContain("email_skipped");

    // Another person's state is untouched by this one's changes.
    const owner = (await (await (await apiAsRole("owner")).get("/api/v1/onboarding")).json()).onboarding;
    // (No seeded account uses "recruiting".)
    expect(owner.role).not.toBe("recruiting");
  });

  test("every role reads and updates only its own state; seeded accounts are already finished", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const res = await api.get("/api/v1/onboarding");
      expect(res.status(), role).toBe(200);
      const patched = await api.patch("/api/v1/onboarding", { data: { homeLayout: "win_and_close" } });
      expect(patched.status(), role).toBe(200);
      const state = (await patched.json()).onboarding;
      expect(state.homeLayout).toBe("win_and_close");
      // Saving a preference never sends a seeded or existing account into onboarding.
      expect(state.finishedAt, role).not.toBeNull();
      await api.patch("/api/v1/onboarding", { data: { homeLayout: "getting_started" } });
    }
    const globex = (await (await (await globexApi()).get("/api/v1/onboarding")).json()).onboarding;
    expect(globex.homeLayout).toBe("getting_started");
  });

  test("validation 422, CSRF 403, 401 signed out, 403 for API keys", async () => {
    const owner = await apiAsRole("owner");
    for (const data of [
      { goals: ["outbound", "nonsense"] },
      { homeLayout: "dashboard" },
      { role: "astronaut" },
      { antiSpamAccepted: false },
      { finished: false },
      { unknownField: 1 },
    ]) {
      expect((await owner.patch("/api/v1/onboarding", { data })).status(), JSON.stringify(data)).toBe(422);
    }
    expect(
      (
        await owner.patch("/api/v1/onboarding", { data: { homeLayout: "win_and_close" }, headers: EVIL_ORIGIN })
      ).status(),
    ).toBe(403);
    expect((await owner.post("/api/v1/onboarding", { headers: EVIL_ORIGIN })).status()).toBe(403);
    const anon = await anonymous();
    expect((await anon.get("/api/v1/onboarding")).status()).toBe(401);
    expect((await anon.patch("/api/v1/onboarding", { data: { homeLayout: "win_and_close" } })).status()).toBe(401);
    expect((await (await acmeKeyClient("owner")).get("/api/v1/onboarding")).status()).toBe(403);
  });

  test("starting is idempotent and never re-opens a finished flow", async () => {
    const owner = await apiAsRole("owner");
    const res = await owner.post("/api/v1/onboarding");
    expect(res.status()).toBe(200);
    expect((await res.json()).onboarding.finishedAt).not.toBeNull();
    const viewer = await apiAsRole("viewer");
    expect((await (await viewer.post("/api/v1/onboarding")).json()).onboarding.finishedAt).not.toBeNull();
  });
});
