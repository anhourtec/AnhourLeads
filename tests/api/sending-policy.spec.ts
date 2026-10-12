import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { orgId, pg, uniq } from "./_engage";
import { randomUUID } from "node:crypto";

/**
 * Sending protection policy, its counters, bounce logs and the deliverability overview.
 * Only the bounce threshold is changed (briefly) so the sending engine tests running in parallel
 * keep the defaults; the original policy is always restored.
 */

interface Policy {
  autoPauseOnAuthIssue: boolean;
  restrictUnverified: boolean;
  restrictCatchAll: boolean;
  requireSignature: boolean;
  oneClickUnsubscribe: boolean;
  gradualRamp: boolean;
  bounceGuard: boolean;
  bounceThreshold: number;
  workspaceDailyLimit: number | null;
}

const FLAGS = [
  "autoPauseOnAuthIssue",
  "restrictUnverified",
  "restrictCatchAll",
  "requireSignature",
  "gradualRamp",
  "bounceGuard",
  "bounceThreshold",
  "workspaceDailyLimit",
] as const;

function restorable(p: Policy) {
  return Object.fromEntries(FLAGS.map((k) => [k, p[k]]));
}

let acmeOriginal: Policy;
let globexOriginal: Policy;
const seeded: string[] = [];
const marker = uniq("wpe-policy");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  acmeOriginal = (await (await (await apiAsRole("owner")).get("/api/v1/sending_policy")).json()).sending_policy;
  globexOriginal = (await (await (await apiAs(GLOBEX_OWNER)).get("/api/v1/sending_policy")).json()).sending_policy;
});

test.afterAll(async () => {
  const owner = await apiAsRole("owner");
  expect((await owner.patch("/api/v1/sending_policy", { data: restorable(acmeOriginal) })).status()).toBe(200);
  const globex = await apiAs(GLOBEX_OWNER);
  expect((await globex.patch("/api/v1/sending_policy", { data: restorable(globexOriginal) })).status()).toBe(200);
  if (seeded.length) await pg().query("delete from outbound_message where id = any($1)", [seeded]);
});

test.describe("sending policy: /api/v1/sending_policy", () => {
  for (const role of ROLES) {
    test(`GET as ${role} follows the matrix and exposes every flag`, async () => {
      const api = await apiAsRole(role);
      const res = await api.get("/api/v1/sending_policy");
      expect(res.status()).toBe(expected(role, "deliverability:read"));
      if (res.status() === 200) {
        const { sending_policy, counters } = await res.json();
        for (const k of FLAGS) expect(sending_policy).toHaveProperty(k);
        expect(sending_policy.oneClickUnsubscribe).toBe(true);
        expect(typeof counters.riskySendsHeldBack).toBe("number");
        expect(counters.days).toBe(30);
      }
    });

    test(`PATCH as ${role} follows the matrix`, async () => {
      const api = await apiAsRole(role);
      // Same value as now: allowed roles get 200 without changing anything.
      const res = await api.patch("/api/v1/sending_policy", {
        data: { bounceThreshold: acmeOriginal.bounceThreshold },
      });
      expect(res.status()).toBe(expected(role, "deliverability:manage"));
    });
  }

  test("PATCH is audited and the change reads back", async () => {
    const admin = await apiAsRole("admin");
    const next = acmeOriginal.bounceThreshold === 0.07 ? 0.08 : 0.07;
    const res = await admin.patch("/api/v1/sending_policy", { data: { bounceThreshold: next } });
    expect(res.status()).toBe(200);
    expect((await res.json()).sending_policy.bounceThreshold).toBeCloseTo(next);
    const read = (await (await admin.get("/api/v1/sending_policy")).json()).sending_policy as Policy;
    expect(read.bounceThreshold).toBeCloseTo(next);
    expect(read.restrictCatchAll).toBe(acmeOriginal.restrictCatchAll);

    const audit = await (await admin.get("/api/v1/audit_logs?action=sending_policy.update&per_page=5")).json();
    const entry = audit.audit_logs[0];
    expect(entry.action).toBe("sending_policy.update");
    expect(entry.metadata.changes.bounceThreshold.to).toBeCloseTo(next);

    const back = await admin.patch("/api/v1/sending_policy", {
      data: { bounceThreshold: acmeOriginal.bounceThreshold },
    });
    expect((await back.json()).sending_policy.bounceThreshold).toBeCloseTo(acmeOriginal.bounceThreshold);
  });

  test("validation errors answer 422, and one-click unsubscribe can't be turned off", async () => {
    const admin = await apiAsRole("admin");
    for (const data of [
      { oneClickUnsubscribe: false },
      { bounceThreshold: 0.9 },
      { bounceThreshold: 0 },
      { workspaceDailyLimit: 0 },
      { workspaceDailyLimit: 1.5 },
      { restrictCatchAll: "yes" },
      { unknownFlag: true },
    ]) {
      const res = await admin.patch("/api/v1/sending_policy", { data });
      expect(res.status(), JSON.stringify(data)).toBe(422);
    }
    const read = (await (await admin.get("/api/v1/sending_policy")).json()).sending_policy as Policy;
    expect(read.oneClickUnsubscribe).toBe(true);
  });

  test("unauthenticated requests get 401; cross-site writes get 403", async () => {
    const anon = await anonymous();
    expect((await anon.get("/api/v1/sending_policy")).status()).toBe(401);
    expect((await anon.patch("/api/v1/sending_policy", { data: { bounceGuard: true } })).status()).toBe(401);
    expect((await anon.get("/api/v1/deliverability/overview")).status()).toBe(401);
    expect((await anon.get("/api/v1/deliverability/bounce_logs")).status()).toBe(401);
    const admin = await apiAsRole("admin");
    const res = await admin.patch("/api/v1/sending_policy", {
      data: { bounceThreshold: acmeOriginal.bounceThreshold },
      headers: { origin: "https://evil.example" },
    });
    expect(res.status()).toBe(403);
  });

  test("each workspace has its own policy", async () => {
    const globex = await apiAs(GLOBEX_OWNER);
    const next = globexOriginal.bounceThreshold === 0.09 ? 0.1 : 0.09;
    expect((await globex.patch("/api/v1/sending_policy", { data: { bounceThreshold: next } })).status()).toBe(200);
    const acme = (await (await (await apiAsRole("admin")).get("/api/v1/sending_policy")).json())
      .sending_policy as Policy;
    expect(acme.bounceThreshold).toBeCloseTo(acmeOriginal.bounceThreshold);
    await globex.patch("/api/v1/sending_policy", { data: { bounceThreshold: globexOriginal.bounceThreshold } });
  });
});

test.describe("sending protection counters and bounce logs", () => {
  test.beforeAll(async () => {
    const acme = await orgId("acme");
    const rows = [
      {
        status: "blocked",
        reason: "Policy: the address is on a catch-all domain.",
        to: `${marker}-held@example.invalid`,
      },
      { status: "blocked", reason: "Suppressed email (manual).", to: `${marker}-dnc@example.invalid` },
      { status: "bounced", reason: null, to: `${marker}-bounce@example.invalid` },
    ];
    for (const r of rows) {
      const id = randomUUID();
      seeded.push(id);
      await pg().query(
        `insert into outbound_message (id, organization_id, to_email, subject, body, status, blocked_reason, sent_at, created_at)
         values ($1, $2, $3, $4, 'body', $5, $6, $7, now())`,
        [id, acme, r.to, `${marker} subject`, r.status, r.reason, r.status === "bounced" ? new Date() : null],
      );
    }
  });

  test("counters include held-back and bounced messages", async () => {
    const admin = await apiAsRole("admin");
    const { counters } = await (await admin.get("/api/v1/sending_policy")).json();
    expect(counters.riskySendsHeldBack).toBeGreaterThanOrEqual(1);
    expect(counters.blockedMessages).toBeGreaterThanOrEqual(2);
    expect(counters.bounced).toBeGreaterThanOrEqual(1);
  });

  for (const role of ROLES) {
    test(`bounce logs as ${role} follow the matrix`, async () => {
      const api = await apiAsRole(role);
      const res = await api.get("/api/v1/deliverability/bounce_logs?per_page=100");
      expect(res.status()).toBe(expected(role, "deliverability:read"));
      if (res.status() === 200) {
        const body = await res.json();
        const mine = body.bounce_logs.filter((e: { toEmail: string }) => e.toEmail.startsWith(marker));
        expect(mine.length).toBe(3);
        expect(body.pagination.per_page).toBe(100);
      }
    });

    test(`overview as ${role} follows the matrix`, async () => {
      const api = await apiAsRole(role);
      const res = await api.get("/api/v1/deliverability/overview?days=30");
      expect(res.status()).toBe(expected(role, "deliverability:read"));
      if (res.status() === 200) {
        const { overview, mailboxes } = await res.json();
        expect(overview.series).toHaveLength(30);
        expect(overview.thisMonth).toHaveProperty("deliveredRate");
        expect(Array.isArray(overview.recommendations)).toBe(true);
        expect(Array.isArray(mailboxes)).toBe(true);
      }
    });
  }

  test("policy-only filter and bounce reasons", async () => {
    const admin = await apiAsRole("admin");
    const body = await (await admin.get("/api/v1/deliverability/bounce_logs?policyOnly=true&per_page=100")).json();
    const mine = body.bounce_logs.filter((e: { toEmail: string }) => e.toEmail.startsWith(marker));
    expect(mine.map((e: { toEmail: string }) => e.toEmail)).toEqual([`${marker}-held@example.invalid`]);
    expect(mine[0].policy).toBe(true);
    const bounced = await (await admin.get("/api/v1/deliverability/bounce_logs?status=bounced&per_page=100")).json();
    expect(bounced.bounce_logs.every((e: { status: string }) => e.status === "bounced")).toBe(true);
    expect((await admin.get("/api/v1/deliverability/bounce_logs?status=nope")).status()).toBe(422);
  });

  test("another workspace never sees Acme's messages or mailboxes", async () => {
    const globex = await apiAs(GLOBEX_OWNER);
    const body = await (await globex.get("/api/v1/deliverability/bounce_logs?per_page=100")).json();
    expect(body.bounce_logs.some((e: { toEmail: string }) => e.toEmail.startsWith(marker))).toBe(false);
    const { rows } = await pg().query<{ id: string }>("select id from mailbox where organization_id = $1 limit 1", [
      await orgId("acme"),
    ]);
    test.skip(!rows[0], "Acme has no mailbox");
    expect((await globex.get(`/api/v1/deliverability/overview?mailboxId=${rows[0]?.id}`)).status()).toBe(404);
  });

  test("overview validates its query", async () => {
    const admin = await apiAsRole("admin");
    expect((await admin.get("/api/v1/deliverability/overview?days=14")).status()).toBe(422);
  });

  test("delivered, bounced and reply counts match the seeded messages for one mailbox", async () => {
    const acme = await orgId("acme");
    const mailbox = randomUUID();
    const email = `${marker}-mbx@acme.test`;
    await pg().query(
      `insert into mailbox (id, organization_id, email, provider, created_at, updated_at) values ($1, $2, $3, 'smtp', now(), now())`,
      [mailbox, acme, email],
    );
    try {
      const contact = randomUUID();
      await pg().query(
        `insert into contact (id, organization_id, email, created_at, updated_at) values ($1, $2, $3, now(), now())`,
        [contact, acme, `${marker}-c@example.invalid`],
      );
      const ids: string[] = [];
      for (const status of ["sent", "sent", "sent", "bounced"]) {
        const id = randomUUID();
        ids.push(id);
        await pg().query(
          `insert into outbound_message (id, organization_id, mailbox_id, contact_id, to_email, subject, body, status, sent_at, created_at)
           values ($1, $2, $3, $4, 'x@example.invalid', 's', 'b', $5, now(), now())`,
          [id, acme, mailbox, contact, status],
        );
      }
      await pg().query(
        `insert into activity (id, organization_id, contact_id, type, summary, occurred_at) values ($1, $2, $3, 'email_replied', 'Replied', now())`,
        [randomUUID(), acme, contact],
      );
      const admin = await apiAsRole("admin");
      const res = await admin.get(`/api/v1/deliverability/overview?mailboxId=${mailbox}`);
      expect(res.status()).toBe(200);
      const { overview, mailboxes } = await res.json();
      expect(overview.thisMonth).toMatchObject({ sent: 4, delivered: 3, bounced: 1, replies: 1 });
      expect(overview.thisMonth.deliveredRate).toBeCloseTo(0.75);
      expect(overview.thisMonth.openRate).toBeNull();
      const today = overview.series[overview.series.length - 1];
      expect(today).toMatchObject({ sent: 4, delivered: 3, bounced: 1, replied: 1 });
      const row = mailboxes.find((m: { id: string }) => m.id === mailbox);
      expect(row).toMatchObject({ sent30: 4, bounced30: 1, hasSignature: false });
      await pg().query("delete from activity where contact_id = $1", [contact]);
      await pg().query("delete from outbound_message where id = any($1)", [ids]);
      await pg().query("delete from contact where id = $1", [contact]);
    } finally {
      await pg().query("delete from mailbox where id = $1", [mailbox]);
    }
  });
});
