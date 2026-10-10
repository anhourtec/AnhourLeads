import { type APIRequestContext, expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, BASE_URL, GLOBEX_OWNER } from "../support/session";
import { mailpitMailbox, pg, uniq } from "./_engage";

const owner = () => apiAsRole("owner");

async function createMailbox(api: APIRequestContext, data: Record<string, unknown> = {}) {
  const res = await api.post("/api/v1/email_accounts", { data: mailpitMailbox(data) });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).email_account as Record<string, unknown> & { id: string };
}

function assertNoSecret(body: unknown, secret: string) {
  const text = JSON.stringify(body);
  expect(text).not.toContain(secret);
  expect(text).not.toContain("smtpPasswordEnc");
}

test.describe("mailboxes (email_accounts): role matrix", () => {
  test("GET /email_accounts for every role", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).get("/api/v1/email_accounts");
      expect(res.status(), role).toBe(expected(role, "mailbox:read"));
    }
  });

  test("POST /email_accounts for every role", async () => {
    for (const role of ROLES) {
      const res = await (await apiAsRole(role)).post("/api/v1/email_accounts", { data: mailpitMailbox() });
      expect(res.status(), role).toBe(expected(role, "mailbox:create", 201));
    }
  });

  test("GET, PATCH, test, DELETE /email_accounts/[id] for every role", async () => {
    for (const role of ROLES) {
      const api = await apiAsRole(role);
      const mailbox = await createMailbox(await owner());
      expect((await api.get(`/api/v1/email_accounts/${mailbox.id}`)).status(), role).toBe(
        expected(role, "mailbox:read"),
      );
      const patch = await api.patch(`/api/v1/email_accounts/${mailbox.id}`, { data: { dailyLimit: 25 } });
      expect(patch.status(), role).toBe(expected(role, "mailbox:update"));
      const check = await api.post(`/api/v1/email_accounts/${mailbox.id}/test`);
      expect(check.status(), role).toBe(expected(role, "mailbox:update"));
      const del = await api.delete(`/api/v1/email_accounts/${mailbox.id}`);
      expect(del.status(), role).toBe(expected(role, "mailbox:delete"));
    }
  });

  test("unauthenticated requests get 401", async () => {
    const api = await anonymous();
    expect((await api.get("/api/v1/email_accounts")).status()).toBe(401);
    expect((await api.post("/api/v1/email_accounts", { data: mailpitMailbox() })).status()).toBe(401);
    expect((await api.post("/api/v1/email_accounts/x/test")).status()).toBe(401);
  });

  test("cross-site cookie writes are refused", async () => {
    const api = await owner();
    const res = await api.post(`${BASE_URL}/api/v1/email_accounts`, {
      headers: { origin: "https://evil.example" },
      data: mailpitMailbox(),
    });
    expect(res.status()).toBe(403);
    const mailbox = await createMailbox(api);
    const test_ = await api.post(`/api/v1/email_accounts/${mailbox.id}/test`, {
      headers: { origin: "https://evil.example" },
    });
    expect(test_.status()).toBe(403);
  });
});

test.describe("mailboxes (email_accounts): behaviour", () => {
  test("the SMTP password is write-only and encrypted at rest", async () => {
    const api = await owner();
    const secret = `pw-${uniq("secret")}-9876`;
    const created = await createMailbox(api, { smtpUser: "sender", smtpPassword: secret });
    assertNoSecret(created, secret);
    expect(created.hasPassword).toBe(true);
    expect(created.passwordHint).toBe("9876");

    const { rows } = await pg().query<{ smtp_password_enc: string }>(
      "select smtp_password_enc from mailbox where id = $1",
      [created.id],
    );
    expect(rows[0].smtp_password_enc).toBeTruthy();
    expect(rows[0].smtp_password_enc).not.toContain(secret);

    for (const res of [
      await api.get(`/api/v1/email_accounts/${created.id}`),
      await api.get("/api/v1/email_accounts"),
      await api.patch(`/api/v1/email_accounts/${created.id}`, { data: { displayName: "Renamed" } }),
    ]) {
      expect(res.status()).toBe(200);
      assertNoSecret(await res.json(), secret);
    }

    // Omitting the password keeps it; an empty string clears it.
    const kept = await (await api.get(`/api/v1/email_accounts/${created.id}`)).json();
    expect(kept.email_account.hasPassword).toBe(true);
    const cleared = await api.patch(`/api/v1/email_accounts/${created.id}`, { data: { smtpPassword: "" } });
    expect((await cleared.json()).email_account.hasPassword).toBe(false);
  });

  test("test connection succeeds against Mailpit and fails plainly elsewhere", async () => {
    const api = await owner();
    const good = await createMailbox(api);
    const ok = await api.post(`/api/v1/email_accounts/${good.id}/test`);
    expect(ok.status()).toBe(200);
    expect((await ok.json()).ok).toBe(true);

    const secret = `pw-${uniq("bad")}`;
    const bad = await createMailbox(api, { smtpPort: 1, smtpUser: "sender", smtpPassword: secret });
    const failed = await api.post(`/api/v1/email_accounts/${bad.id}/test`);
    expect(failed.status()).toBe(200);
    const body = await failed.json();
    expect(body.ok).toBe(false);
    expect(body.message).toMatch(/connect|timed out/i);
    expect(JSON.stringify(body)).not.toContain(secret);

    const noHost = await createMailbox(api, { smtpHost: null });
    expect((await (await api.post(`/api/v1/email_accounts/${noHost.id}/test`)).json()).ok).toBe(false);
  });

  test("deliverability hints flag a missing postal address", async () => {
    const api = await owner();
    const mailbox = await createMailbox(api, { postalAddress: null });
    expect(mailbox.readyToSend).toBe(false);
    expect(JSON.stringify(mailbox.issues)).toMatch(/postal address/i);
  });

  test("validation errors are 422", async () => {
    const api = await owner();
    const bad = async (data: Record<string, unknown>) =>
      (await api.post("/api/v1/email_accounts", { data: mailpitMailbox(data) })).status();
    expect(await bad({ email: "not-an-email" })).toBe(422);
    expect(await bad({ dailyLimit: 0 })).toBe(422);
    expect(await bad({ dailyLimit: 501 })).toBe(422);
    expect(await bad({ sendingWindowStart: "9am" })).toBe(422);
    expect(await bad({ sendingWindowEnd: "24:00" })).toBe(422);
    expect(await bad({ timezone: "Mars/Olympus" })).toBe(422);
    expect(await bad({ provider: "aol" })).toBe(422);
    expect(await bad({ smtpSecure: "maybe" })).toBe(422);
    expect(await bad({ smtpPort: 70000 })).toBe(422);
    expect(await bad({ unknownField: true })).toBe(422);

    const mailbox = await createMailbox(api);
    expect(await bad({ email: mailbox.email })).toBe(422);
    const patch = await api.patch(`/api/v1/email_accounts/${mailbox.id}`, { data: { timezone: "Nowhere/Land" } });
    expect(patch.status()).toBe(422);
  });

  test("a mailbox used by an active sequence keeps its postal address and can't be deleted", async () => {
    const api = await owner();
    const mailbox = await createMailbox(api);
    const created = await api.post("/api/v1/emailer_campaigns", {
      data: {
        name: uniq("seq"),
        mailboxId: mailbox.id,
        steps: [{ type: "auto_email", subject: "Hi", body: "Hello" }],
      },
    });
    const sequenceId = (await created.json()).emailer_campaign.id;
    expect((await api.post(`/api/v1/emailer_campaigns/${sequenceId}/approve`)).status()).toBe(200);

    const clear = await api.patch(`/api/v1/email_accounts/${mailbox.id}`, { data: { postalAddress: null } });
    expect(clear.status()).toBe(422);
    expect((await api.delete(`/api/v1/email_accounts/${mailbox.id}`)).status()).toBe(409);

    await api.post(`/api/v1/emailer_campaigns/${sequenceId}/abort`);
    expect((await api.delete(`/api/v1/email_accounts/${mailbox.id}`)).status()).toBe(200);
  });
});

test.describe("mailboxes (email_accounts): workspace isolation", () => {
  test("Globex can't read, change, test or delete Acme mailboxes", async () => {
    const acme = await owner();
    const mailbox = await createMailbox(acme);
    const globex = await apiAs(GLOBEX_OWNER);
    expect((await globex.get(`/api/v1/email_accounts/${mailbox.id}`)).status()).toBe(404);
    expect((await globex.patch(`/api/v1/email_accounts/${mailbox.id}`, { data: { dailyLimit: 1 } })).status()).toBe(
      404,
    );
    expect((await globex.post(`/api/v1/email_accounts/${mailbox.id}/test`)).status()).toBe(404);
    expect((await globex.delete(`/api/v1/email_accounts/${mailbox.id}`)).status()).toBe(404);
    const all = await (await globex.get("/api/v1/email_accounts")).json();
    expect(all.email_accounts.some((m: { id: string }) => m.id === mailbox.id)).toBe(false);
    expect((await acme.get(`/api/v1/email_accounts/${mailbox.id}`)).status()).toBe(200);
  });
});
