import { expect, test } from "@playwright/test";

import { closeDiscoDb, insertIndexCompany, insertIndexPerson, q } from "../support/discovery-fixtures";
import { anonymous, apiAs, PLATFORM_ADMIN, TENANT_URL } from "../support/session";

/**
 * Public removal requests (/privacy/removal): nothing is removed until the request is confirmed
 * by a link mailed to the address (Mailpit locally) or, for a domain, by a DNS TXT record or a
 * link mailed to an address at that domain. Confirmed requests become index opt-outs and delete
 * the matching index rows.
 */

const MAILPIT = process.env.TEST_MAILPIT_URL ?? "http://localhost:48026";
const RUN = Date.now().toString(36);
const DOMAIN = `removal-${RUN}.disco.test`;
const EMAIL = `jo.remove@${DOMAIN}`;
const DOMAIN2 = `wipe-${RUN}.disco.test`;
let personId = "";
let company2 = "";

interface MailpitSummary {
  ID: string;
  To: Array<{ Address: string }>;
  Subject: string;
}

async function confirmationLink(to: string): Promise<{ token: string; secret: string; path: string }> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const body = (await res.json()) as { messages: MailpitSummary[] };
    const msg = body.messages.find((m) => m.Subject === "Confirm your removal request");
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { Text: string };
      const m = full.Text.match(/(\/privacy\/removal\/confirm\/([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+))/);
      if (!m?.[1] || !m[2] || !m[3]) throw new Error("no confirmation link in the message");
      return { path: m[1], token: m[2], secret: m[3] };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no confirmation email for ${to}`);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const companyId = await insertIndexCompany({ domain: DOMAIN, name: "Removal Co" });
  personId = await insertIndexPerson({
    companyId,
    fullName: "Jo Remove",
    title: "Founder",
    seniority: "founder",
    department: "C-Suite",
    publishedEmail: EMAIL,
    sourceUrl: `https://${DOMAIN}/team`,
  });
  company2 = await insertIndexCompany({ domain: DOMAIN2, name: "Wipe Co" });
});

test.afterAll(async () => {
  await q("delete from index_company where domain like $1", [`%${RUN}.disco.test`]);
  await q("delete from index_optout where value like $1", [`%${RUN}.disco.test%`]);
  await q("delete from verification where identifier like 'index-removal:%' and value like $1", [
    `%${RUN}.disco.test%`,
  ]);
  await closeDiscoDb();
});

test("an email removal is confirmed by the mailed link, then the person leaves the index", async () => {
  const api = await anonymous();
  const res = await api.post("/privacy/removal/submit", {
    data: { kind: "email", value: EMAIL, reason: "Please remove me" },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { request } = await res.json();
  expect(request).toMatchObject({ kind: "email", value: EMAIL, txtRecord: null });
  expect(request.sentTo).toMatch(/^j•+@/);
  expect(JSON.stringify(request)).not.toMatch(/secret/i);

  // Nothing changes before confirmation.
  expect(await q("select 1 from index_person where id = $1", [personId])).toHaveLength(1);
  expect(await q("select 1 from index_optout where value = $1", [EMAIL])).toHaveLength(0);

  const link = await confirmationLink(EMAIL);
  expect(link.token).toBe(request.token);
  const page = await api.get(link.path);
  expect(page.status()).toBe(200);
  const html = await page.text();
  expect(html).toContain("Confirm removal");
  expect(html).toContain(EMAIL);
  // Opening the page alone removes nothing (mail scanners follow links).
  expect(await q("select 1 from index_person where id = $1", [personId])).toHaveLength(1);

  const wrong = await api.post("/privacy/removal/verify", {
    data: { token: link.token, secret: "x".repeat(24), method: "link" },
  });
  expect(wrong.status()).toBe(404);
  const dns = await api.post("/privacy/removal/verify", { data: { token: link.token, method: "dns" } });
  expect(dns.status()).toBe(422);

  const ok = await api.post("/privacy/removal/verify", {
    data: { token: link.token, secret: link.secret, method: "link" },
  });
  expect(ok.status(), await ok.text()).toBe(200);
  expect(await ok.json()).toMatchObject({ confirmed: true, kind: "email", value: EMAIL, removed: { people: 1 } });
  expect(await q("select 1 from index_person where id = $1", [personId])).toHaveLength(0);
  const [optout] = await q<{ requested_by: string; reason: string }>(
    "select requested_by, reason from index_optout where kind = 'email' and value = $1",
    [EMAIL],
  );
  expect(optout).toMatchObject({ requested_by: "removal_request:email", reason: "Please remove me" });

  // A link works once.
  const reused = await api.post("/privacy/removal/verify", {
    data: { token: link.token, secret: link.secret, method: "link" },
  });
  expect(reused.status()).toBe(404);
  const expired = await api.get(link.path);
  expect(await expired.text()).toContain("This link isn't valid");
});

test("a domain removal: DNS proof is checked, an address at the domain can confirm", async () => {
  const api = await anonymous();
  const contact = `it@${DOMAIN2}`;
  const res = await api.post("/privacy/removal/submit", {
    data: { kind: "domain", value: `https://www.${DOMAIN2}/about`, contactEmail: contact },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { request } = await res.json();
  expect(request.value).toBe(DOMAIN2);
  expect(request.txtRecord).toBe(`anhour-optout=${request.token}`);

  // No TXT record on a test domain: refused with a clear message, nothing removed.
  const dns = await api.post("/privacy/removal/verify", { data: { token: request.token, method: "dns" } });
  expect(dns.status()).toBe(409);
  expect((await dns.json()).error).toContain("TXT record");
  expect(await q("select 1 from index_company where id = $1", [company2])).toHaveLength(1);

  const link = await confirmationLink(contact);
  const ok = await api.post("/privacy/removal/verify", {
    data: { token: link.token, secret: link.secret, method: "link" },
  });
  expect(ok.status(), await ok.text()).toBe(200);
  expect((await ok.json()).removed.companies).toBe(1);
  expect(await q("select 1 from index_company where id = $1", [company2])).toHaveLength(0);

  // The platform screen lists it as an opt-out.
  const admin = await apiAs(PLATFORM_ADMIN);
  const list = await (await admin.get(`/api/v1/platform/optouts?q=${DOMAIN2}`)).json();
  expect(list.optouts).toEqual([
    expect.objectContaining({ kind: "domain", value: DOMAIN2, requestedBy: "removal_request:email" }),
  ]);
});

test("a domain request without a contact address relies on DNS and shows as pending", async () => {
  const api = await anonymous();
  const domain = `pending-${RUN}.disco.test`;
  const res = await api.post("/privacy/removal/submit", { data: { kind: "domain", value: domain } });
  expect(res.status()).toBe(201);
  const { request } = await res.json();
  expect(request.sentTo).toBeNull();
  const admin = await apiAs(PLATFORM_ADMIN);
  const pending = await (await admin.get("/api/v1/platform/optouts/requests")).json();
  expect(pending.requests).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "domain", value: domain, verification: "DNS" })]),
  );
});

test("invalid requests get 422", async () => {
  const api = await anonymous();
  const bad = [
    { kind: "phone", value: "123" },
    { kind: "email", value: "not-an-email" },
    { kind: "domain", value: "nodot" },
    { kind: "domain", value: `x-${RUN}.disco.test`, contactEmail: "someone@elsewhere.example" },
    { kind: "email", value: `a@${RUN}.disco.test`, extra: true },
  ];
  for (const data of bad)
    expect((await api.post("/privacy/removal/submit", { data })).status(), JSON.stringify(data)).toBe(422);
  expect((await api.post("/privacy/removal/verify", { data: { token: "short", method: "link" } })).status()).toBe(422);
  expect(
    (await api.post("/privacy/removal/verify", { data: { token: "a".repeat(24), method: "magic" } })).status(),
  ).toBe(422);
  expect((await api.post("/privacy/removal/verify", { data: { token: "a".repeat(24), method: "dns" } })).status()).toBe(
    404,
  );
});

test("the same address can't be flooded with confirmation emails", async () => {
  const api = await anonymous();
  const email = `flood-${RUN}@disco.test`;
  for (let i = 0; i < 3; i++)
    expect((await api.post("/privacy/removal/submit", { data: { kind: "email", value: email } })).status()).toBe(201);
  const fourth = await api.post("/privacy/removal/submit", { data: { kind: "email", value: email } });
  expect(fourth.status()).toBe(429);
});

test("cross-site posts are refused and workspace hostnames don't serve these pages", async () => {
  const api = await anonymous();
  const cross = await api.post("/privacy/removal/submit", {
    data: { kind: "email", value: `x-${RUN}@disco.test` },
    headers: { origin: "https://evil.example" },
  });
  expect(cross.status()).toBe(403);
  const tenant = await anonymous(TENANT_URL);
  expect((await tenant.get("/privacy/removal")).status()).toBe(404);
  expect(
    (await tenant.post("/privacy/removal/submit", { data: { kind: "email", value: `y-${RUN}@disco.test` } })).status(),
  ).toBe(404);
  const page = await api.get("/privacy/removal");
  expect(page.status()).toBe(200);
  expect(await page.text()).toContain("Remove your information");
});
