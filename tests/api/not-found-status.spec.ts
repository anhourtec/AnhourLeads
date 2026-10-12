import { type APIRequestContext, expect, test } from "@playwright/test";

import { ACME, anonymous, apiAs, GLOBEX_OWNER, TENANT_URL } from "../support/session";
import { uniq } from "./_engage";

/**
 * Pages with a loading boundary stream as soon as rendering starts, so their existence and permission
 * checks live in layouts above that boundary. These assert the HTTP status, not just the not-found UI.
 */

const UNKNOWN = "00000000-0000-4000-8000-000000000000";

interface Records {
  person: string;
  company: string;
  list: string;
  sequence: string;
  research: string;
}

let records: Records;

async function created<T>(api: APIRequestContext, path: string, data: Record<string, unknown>, key: string) {
  const res = await api.post(path, { data });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json())[key] as { id: T }).id;
}

const status = async (api: APIRequestContext, path: string) => (await api.get(path, { maxRedirects: 0 })).status();

test.beforeAll(async () => {
  const owner = await apiAs(ACME.owner);
  const tag = uniq("nf");
  records = {
    person: await created<string>(owner, "/api/v1/contacts", { firstName: "Status", lastName: tag }, "contact"),
    company: await created<string>(owner, "/api/v1/accounts", { name: `Status Co ${tag}` }, "account"),
    list: await created<string>(owner, "/api/v1/labels", { name: `list-${tag}`, entityType: "contact" }, "label"),
    sequence: await created<string>(owner, "/api/v1/emailer_campaigns", { name: `seq-${tag}` }, "emailer_campaign"),
    // Nothing listens on this port, so the job fails fast without touching the network.
    research: await created<string>(owner, "/api/v1/crawl_jobs", { url: "http://127.0.0.1:48099/" }, "crawl_job"),
  };
});

const DETAIL_ROUTES: [keyof Records, string][] = [
  ["person", "/dashboard/people"],
  ["company", "/dashboard/companies"],
  ["list", "/dashboard/lists"],
  ["sequence", "/dashboard/sequences"],
  ["research", "/dashboard/research"],
];

test.describe("detail pages return a real 404", () => {
  test("existing records in the actor's workspace render with 200", async () => {
    const member = await apiAs(ACME.member);
    for (const [key, base] of DETAIL_ROUTES) {
      expect(await status(member, `${base}/${records[key]}`), base).toBe(200);
      expect(await status(member, base), `${base} index`).toBe(200);
    }
  });

  test("unknown ids return 404", async () => {
    const member = await apiAs(ACME.member);
    for (const [, base] of DETAIL_ROUTES) {
      expect(await status(member, `${base}/${UNKNOWN}`), base).toBe(404);
    }
  });

  test("another workspace's ids return 404", async () => {
    const globex = await apiAs(GLOBEX_OWNER);
    for (const [key, base] of DETAIL_ROUTES) {
      expect(await status(globex, `${base}/${records[key]}`), base).toBe(404);
    }
  });
});

test.describe("gated pages return a real 404", () => {
  test("roles without the permission get 404, roles with it get 200", async () => {
    const cases: [string, string, number][] = [
      [ACME.viewer, "/dashboard/settings/audit-log", 404],
      [ACME.manager, "/dashboard/settings/audit-log", 200],
      [ACME.manager, "/dashboard/settings/api-keys", 404],
      [ACME.admin, "/dashboard/settings/api-keys", 200],
      [ACME.member, "/dashboard/platform", 404],
    ];
    for (const [email, path, expected] of cases) {
      expect(await status(await apiAs(email), path), `${email} ${path}`).toBe(expected);
    }
  });

  test("sign-up is not served on a workspace host", async () => {
    const tenant = await anonymous(TENANT_URL);
    try {
      expect(await status(tenant, "/auth/register")).toBe(404);
    } finally {
      await tenant.dispose();
    }
  });
});
