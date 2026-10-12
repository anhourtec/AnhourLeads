import { expect, test } from "@playwright/test";

import { expected, ROLES } from "../support/matrix";
import { ACME, anonymous, apiAs, apiAsRole, GLOBEX_OWNER } from "../support/session";
import { orgId, pg, uniq } from "./_engage";
import { acmeKeyClient, userIdOf } from "./admin-helpers";
import { randomUUID } from "node:crypto";

/**
 * Analytics query: whitelisted metrics, groupings, filters, CSV export, role matrix and workspace
 * isolation. Exact counts come from rows inserted directly for a random day in the past, filtered by
 * a fresh mailbox so other specs' data never skews them.
 */

interface Row {
  key: string;
  label: string;
  value: number;
}

// A random day between 2019 and 2023 so concurrent runs don't share a window.
const DAY = new Date(Date.UTC(2019 + Math.floor(Math.random() * 4), Math.floor(Math.random() * 12), 3));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const at = (offsetDays: number, hour = 10) => new Date(DAY.getTime() + offsetDays * 864e5 + hour * 36e5);
const FROM = iso(DAY);
const TO = iso(new Date(DAY.getTime() + 2 * 864e5));

let acmeMailbox = "";
let acmeSequence = "";
let globexMailbox = "";
let memberId = "";

async function insertMailbox(slug: "acme" | "globex", userId: string | null) {
  const id = randomUUID();
  await pg().query(
    "insert into mailbox (id, organization_id, user_id, email, provider) values ($1, $2, $3, $4, 'smtp')",
    [id, await orgId(slug), userId, `${uniq("an")}@${slug}.test`],
  );
  return id;
}

async function insertMessage(
  slug: "acme" | "globex",
  mailboxId: string,
  status: string,
  when: Date,
  enrollmentId: string | null,
) {
  await pg().query(
    `insert into outbound_message (id, organization_id, mailbox_id, enrollment_id, to_email, subject, body, status, sent_at, created_at)
     values ($1, $2, $3, $4, $5, 'Hi', 'Body', $6, $7, $8)`,
    [
      randomUUID(),
      await orgId(slug),
      mailboxId,
      enrollmentId,
      `${uniq("to")}@example.test`,
      status,
      status === "blocked" ? null : when,
      when,
    ],
  );
}

test.beforeAll(async () => {
  memberId = await userIdOf(ACME.member);
  const acme = await orgId("acme");
  acmeMailbox = await insertMailbox("acme", memberId);
  globexMailbox = await insertMailbox("globex", null);
  acmeSequence = randomUUID();
  await pg().query("insert into sequence (id, organization_id, name, mailbox_id) values ($1, $2, $3, $4)", [
    acmeSequence,
    acme,
    `Analytics ${uniq("seq")}`,
    acmeMailbox,
  ]);
  const contactId = randomUUID();
  await pg().query(
    "insert into contact (id, organization_id, first_name, email, source) values ($1, $2, 'Ana', $3, 'test')",
    [contactId, acme, `${uniq("ana")}@example.test`],
  );
  const enrollmentId = randomUUID();
  await pg().query("insert into enrollment (id, organization_id, sequence_id, contact_id) values ($1, $2, $3, $4)", [
    enrollmentId,
    acme,
    acmeSequence,
    contactId,
  ]);
  // Day 0: two sent (one from the sequence) + one bounced; day 1: one sent; day 2: one blocked.
  await insertMessage("acme", acmeMailbox, "sent", at(0), enrollmentId);
  await insertMessage("acme", acmeMailbox, "sent", at(0, 11), null);
  await insertMessage("acme", acmeMailbox, "bounced", at(0, 12), enrollmentId);
  await insertMessage("acme", acmeMailbox, "sent", at(1), null);
  await insertMessage("acme", acmeMailbox, "blocked", at(2), null);
  // A reply on day 1, with the mailbox in metadata and no actor: attributed to the mailbox owner.
  await pg().query(
    `insert into activity (id, organization_id, contact_id, type, summary, metadata, occurred_at)
     values ($1, $2, $3, 'email_replied', 'Replied', $4, $5)`,
    [randomUUID(), acme, contactId, JSON.stringify({ mailboxId: acmeMailbox, sequenceId: acmeSequence }), at(1, 15)],
  );
  // Globex sends in the same window: must never show up in Acme.
  await insertMessage("globex", globexMailbox, "sent", at(0), null);
  await insertMessage("globex", globexMailbox, "sent", at(1), null);
});

const q = (params: Record<string, string>) => `/api/v1/analytics/query?${new URLSearchParams(params).toString()}`;

test.describe("analytics: access", () => {
  for (const role of ROLES) {
    test(`${role} may run a query per the matrix`, async () => {
      const api = await apiAsRole(role);
      const res = await api.get(q({ metric: "emails_sent", from: FROM, to: TO }));
      expect(res.status()).toBe(expected(role, "analytics:read"));
    });
  }

  test("API keys use their role", async () => {
    const viewer = await acmeKeyClient("viewer");
    expect((await viewer.get(q({ metric: "deals_won" }))).status()).toBe(200);
  });

  test("unauthenticated → 401", async () => {
    const anon = await anonymous();
    expect((await anon.get(q({ metric: "emails_sent" }))).status()).toBe(401);
  });

  test("validation → 422", async () => {
    const api = await apiAsRole("member");
    const cases: Record<string, string>[] = [
      { metric: "not_a_metric" },
      { metric: "emails_sent", groupBy: "planet" },
      { metric: "emails_sent", from: "2026-05-01", to: "2026-01-01" },
      { metric: "emails_sent", from: "yesterday" },
      { metric: "calls_logged", groupBy: "sequence" },
      { metric: "open_pipeline_value", groupBy: "day" },
      { metric: "tasks_completed", sequenceId: acmeSequence },
      { metric: "emails_sent", from: "2020-01-01", to: "2026-01-01" },
    ];
    for (const params of cases) {
      const res = await api.get(q(params));
      expect(res.status(), JSON.stringify(params)).toBe(422);
      expect((await res.json()).error).toBeTruthy();
    }
  });
});

test.describe("analytics: metrics match the data", () => {
  test("sent, delivered, bounced, blocked and replies for a mailbox", async () => {
    const api = await apiAsRole("viewer");
    const total = async (metric: string, extra: Record<string, string> = {}) => {
      const res = await api.get(q({ metric, from: FROM, to: TO, mailboxId: acmeMailbox, ...extra }));
      expect(res.status(), metric).toBe(200);
      return (await res.json()).result.total as number;
    };
    expect(await total("emails_sent")).toBe(4);
    expect(await total("emails_delivered")).toBe(3);
    expect(await total("emails_bounced")).toBe(1);
    expect(await total("emails_blocked")).toBe(1);
    expect(await total("emails_replied")).toBe(1);
    expect(await total("emails_sent", { sequenceId: acmeSequence })).toBe(2);
  });

  test("day buckets fill the whole range with zeros", async () => {
    const api = await apiAsRole("member");
    const { result } = await (
      await api.get(q({ metric: "emails_sent", groupBy: "day", from: FROM, to: TO, mailboxId: acmeMailbox }))
    ).json();
    expect(result.rows.map((r: Row) => r.key)).toEqual([FROM, iso(at(1)), TO]);
    expect(result.rows.map((r: Row) => r.value)).toEqual([3, 1, 0]);
  });

  test("group by rep, sequence and mailbox", async () => {
    const api = await apiAsRole("manager");
    const byRep = (
      await (
        await api.get(q({ metric: "emails_sent", groupBy: "rep", from: FROM, to: TO, mailboxId: acmeMailbox }))
      ).json()
    ).result;
    expect(byRep.rows).toEqual([{ key: memberId, label: expect.any(String), value: 4 }]);
    const replies = (
      await (
        await api.get(q({ metric: "emails_replied", groupBy: "rep", from: FROM, to: TO, mailboxId: acmeMailbox }))
      ).json()
    ).result;
    expect(replies.rows[0].key).toBe(memberId);

    const bySeq = (
      await (
        await api.get(q({ metric: "emails_sent", groupBy: "sequence", from: FROM, to: TO, mailboxId: acmeMailbox }))
      ).json()
    ).result;
    const seqRow = bySeq.rows.find((r: Row) => r.key === acmeSequence);
    expect(seqRow.value).toBe(2);
    expect(seqRow.label).toContain("Analytics");
    expect(bySeq.rows.find((r: Row) => r.key === "none").value).toBe(2);

    const byMailbox = (
      await (await api.get(q({ metric: "emails_sent", groupBy: "mailbox", from: FROM, to: TO }))).json()
    ).result;
    expect(byMailbox.rows.map((r: Row) => r.key)).toEqual([acmeMailbox]);
  });

  test("never aggregates another workspace", async () => {
    const acme = await apiAsRole("owner");
    const acmeTotal = (await (await acme.get(q({ metric: "emails_sent", from: FROM, to: TO }))).json()).result;
    expect(acmeTotal.total).toBe(4);
    const globex = await apiAs(GLOBEX_OWNER);
    const globexTotal = (await (await globex.get(q({ metric: "emails_sent", from: FROM, to: TO }))).json()).result;
    expect(globexTotal.total).toBe(2);

    // Filters pointing at the other workspace are not found.
    expect((await globex.get(q({ metric: "emails_sent", mailboxId: acmeMailbox }))).status()).toBe(404);
    expect((await globex.get(q({ metric: "emails_sent", sequenceId: acmeSequence }))).status()).toBe(404);
    expect((await globex.get(q({ metric: "emails_sent", userId: memberId }))).status()).toBe(404);
    expect((await acme.get(q({ metric: "emails_sent", mailboxId: globexMailbox }))).status()).toBe(404);
  });

  test("CSV export of a report", async () => {
    const api = await apiAsRole("viewer");
    const res = await api.get(
      q({ metric: "emails_sent", groupBy: "day", from: FROM, to: TO, mailboxId: acmeMailbox, format: "csv" }),
    );
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("emails_sent-day.csv");
    const lines = (await res.text()).trim().split(/\r\n/);
    expect(lines[0]).toBe("Day,Emails sent");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toMatch(/,3$/);
  });
});
