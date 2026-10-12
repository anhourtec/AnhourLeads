import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { orgId, pg } from "./_engage";

/**
 * Sending domains (email setup and health → domains): list, add, delete and DNS checks.
 * Every domain this spec adds ends in `.invalid` (RFC 2606: never resolves) and starts with
 * "wpe-sd-", so a rerun can clean up what a failed run left behind.
 */
const RUN = Date.now().toString(36);
const name = (label: string) => `wpe-sd-${label}-${RUN}.invalid`;

interface DomainView {
  id: string;
  domain: string;
  spf: string;
  dkim: string;
  dmarc: string;
  mx: string;
  details: Record<string, { status: string; fix: string | null; example: { value: string } | null }>;
  mailboxes: string[];
  lastCheckedAt: string | null;
}

async function cleanup() {
  await pg().query("delete from sending_domain where domain like 'wpe-sd-%'");
}

async function adminDomain(label: string): Promise<DomainView> {
  const admin = await apiAsRole("admin");
  const res = await admin.post("/api/v1/sending_domains", { data: { domain: name(label) } });
  expect(res.status()).toBe(201);
  return (await res.json()).sending_domain as DomainView;
}

test.describe("sending domains: /api/v1/sending_domains", () => {
  test.describe.configure({ timeout: 60_000 });
  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  for (const role of ROLES) {
    test(`GET as ${role} follows the matrix`, async () => {
      const api = await apiAsRole(role);
      const res = await api.get("/api/v1/sending_domains");
      expect(res.status()).toBe(expected(role, "deliverability:read"));
      if (res.status() === 200) {
        const body = await res.json();
        // Domains of the workspace's mailboxes are listed automatically.
        expect(body.sending_domains.some((d: DomainView) => d.domain === "acme.test")).toBe(true);
      }
    });

    test(`POST, check and DELETE as ${role} follow the matrix`, async () => {
      const api = await apiAsRole(role);
      const created = await api.post("/api/v1/sending_domains", { data: { domain: name(role) } });
      expect(created.status()).toBe(expected(role, "deliverability:manage", 201));
      const target =
        created.status() === 201
          ? ((await created.json()).sending_domain as DomainView)
          : await adminDomain(`for-${role}`);
      const check = await api.post(`/api/v1/sending_domains/${target.id}/check`, { data: {} });
      expect(check.status()).toBe(expected(role, "deliverability:manage"));
      const del = await api.delete(`/api/v1/sending_domains/${target.id}`);
      expect(del.status()).toBe(expected(role, "deliverability:manage"));
    });
  }

  test("a domain without DNS records reports every check as missing, with fixes and examples", async () => {
    const admin = await apiAsRole("admin");
    const res = await admin.post("/api/v1/sending_domains", { data: { domain: "https://www.NOMX.invalid/path" } });
    expect([200, 201]).toContain(res.status());
    const added = (await res.json()).sending_domain as DomainView;
    expect(added.domain).toBe("nomx.invalid");
    const checked = await admin.post(`/api/v1/sending_domains/${added.id}/check`, { data: {} });
    expect(checked.status()).toBe(200);
    const d = (await checked.json()).sending_domain as DomainView;
    expect({ spf: d.spf, dkim: d.dkim, dmarc: d.dmarc, mx: d.mx }).toEqual({
      spf: "missing",
      dkim: "missing",
      dmarc: "missing",
      mx: "missing",
    });
    expect(d.lastCheckedAt).not.toBeNull();
    for (const key of ["spf", "dkim", "dmarc", "mx"]) {
      expect(d.details[key]?.status).toBe("missing");
      expect(d.details[key]?.fix).toBeTruthy();
      expect(d.details[key]?.example?.value).toBeTruthy();
    }
    expect(d.details.spf.example?.value).toContain("v=spf1");
    expect(d.details.dmarc.example?.value).toContain("v=DMARC1");
    await admin.delete(`/api/v1/sending_domains/${added.id}`);
  });

  test("adding the same domain twice returns the existing one", async () => {
    const admin = await apiAsRole("admin");
    const first = await adminDomain("twice");
    const again = await admin.post("/api/v1/sending_domains", { data: { domain: first.domain.toUpperCase() } });
    expect(again.status()).toBe(200);
    expect((await again.json()).sending_domain.id).toBe(first.id);
  });

  test("validation errors answer 422", async () => {
    const admin = await apiAsRole("admin");
    for (const data of [{ domain: "not a domain" }, {}, { domain: "acme.com", extra: true }, { domain: "" }]) {
      const res = await admin.post("/api/v1/sending_domains", { data });
      expect(res.status(), JSON.stringify(data)).toBe(422);
      expect((await res.json()).error).toBeTruthy();
    }
  });

  test("unauthenticated requests get 401", async () => {
    const anon = await anonymous();
    expect((await anon.get("/api/v1/sending_domains")).status()).toBe(401);
    expect((await anon.post("/api/v1/sending_domains", { data: { domain: name("anon") } })).status()).toBe(401);
    expect((await anon.post("/api/v1/sending_domains/x/check", { data: {} })).status()).toBe(401);
    expect((await anon.delete("/api/v1/sending_domains/x")).status()).toBe(401);
  });

  test("cross-site cookie writes are refused (CSRF)", async () => {
    const admin = await apiAsRole("admin");
    const target = await adminDomain("csrf");
    const evil = { origin: "https://evil.example" };
    expect(
      (await admin.post("/api/v1/sending_domains", { data: { domain: name("csrf2") }, headers: evil })).status(),
    ).toBe(403);
    expect((await admin.post(`/api/v1/sending_domains/${target.id}/check`, { data: {}, headers: evil })).status()).toBe(
      403,
    );
    expect((await admin.delete(`/api/v1/sending_domains/${target.id}`, { headers: evil })).status()).toBe(403);
  });

  test("another workspace can't see, check or delete Acme's domains (404)", async () => {
    const target = await adminDomain("iso");
    const globex = await apiAs(GLOBEX_OWNER);
    const list = await (await globex.get("/api/v1/sending_domains")).json();
    expect(list.sending_domains.some((d: DomainView) => d.id === target.id)).toBe(false);
    expect((await globex.post(`/api/v1/sending_domains/${target.id}/check`, { data: {} })).status()).toBe(404);
    expect((await globex.delete(`/api/v1/sending_domains/${target.id}`)).status()).toBe(404);
    const { rows } = await pg().query("select organization_id from sending_domain where id = $1", [target.id]);
    expect(rows[0]?.organization_id).toBe(await orgId("acme"));
  });

  test("unknown ids answer 404", async () => {
    const admin = await apiAsRole("admin");
    expect((await admin.post("/api/v1/sending_domains/does-not-exist/check", { data: {} })).status()).toBe(404);
    expect((await admin.delete("/api/v1/sending_domains/does-not-exist")).status()).toBe(404);
  });
});
