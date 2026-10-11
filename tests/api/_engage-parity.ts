/**
 * Helpers for the engage parity specs (sequences, schedules, templates, emails, tasks, sending
 * policies). Fixtures other features own are inserted straight into the database.
 */
import { type APIRequestContext, expect, request } from "@playwright/test";

import { apiAs, apiAsRole, BASE_URL, PASSWORD } from "../support/session";
import { mailpitMailbox, orgId, pg, uniq } from "./_engage";

export { uniq };

export const EVIL = { origin: "https://evil.example" };

export const owner = () => apiAsRole("owner");

export async function createMailbox(api: APIRequestContext, data: Record<string, unknown> = {}): Promise<string> {
  const res = await api.post("/api/v1/email_accounts", { data: mailpitMailbox(data) });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).email_account.id;
}

export interface SequenceOptions {
  reviewMode?: "all" | "first_step" | "none";
  steps?: Record<string, unknown>[];
  mailbox?: Record<string, unknown>;
  mailboxId?: string;
  activate?: boolean;
  extra?: Record<string, unknown>;
}

/** A sequence sending through Mailpit. Returns its id, mailbox id, steps and a unique subject marker. */
export async function readySequence(api: APIRequestContext, opts: SequenceOptions = {}) {
  const marker = uniq("subj");
  const mailboxId = opts.mailboxId ?? (await createMailbox(api, opts.mailbox));
  const res = await api.post("/api/v1/emailer_campaigns", {
    data: {
      name: uniq("seq"),
      mailboxId,
      reviewMode: opts.reviewMode ?? "none",
      steps: opts.steps ?? [
        { type: "auto_email", waitDays: 0, subject: `Hello {{first_name}} ${marker}`, body: "Hi {{first_name}}." },
      ],
      ...opts.extra,
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  const id: string = body.emailer_campaign.id;
  if (opts.activate !== false) {
    const approve = await api.post(`/api/v1/emailer_campaigns/${id}/approve`);
    expect(approve.status(), await approve.text()).toBe(200);
  }
  return { id, mailboxId, marker, steps: body.emailer_steps as { id: string; variants: { id: string }[] }[] };
}

export async function enroll(api: APIRequestContext, sequenceId: string, contactIds: string[]) {
  const res = await api.post(`/api/v1/emailer_campaigns/${sequenceId}/add_contact_ids`, { data: { contactIds } });
  expect(res.status(), await res.text()).toBe(200);
  return res.json() as Promise<{ enrolled_contact_ids: string[]; skipped: { contactId: string; reason: string }[] }>;
}

export async function runNow(api: APIRequestContext, sequenceId: string) {
  const res = await api.post(`/api/v1/emailer_campaigns/${sequenceId}/run_now`);
  expect(res.status(), await res.text()).toBe(200);
  return (await res.json()).run as Record<string, number | string | boolean>;
}

export interface MessageRow {
  id: string;
  status: string;
  subject: string;
  body: string;
  toEmail: string;
  blockedReason: string | null;
  variantLabel: string | null;
}

export async function messages(api: APIRequestContext, sequenceId: string, status?: string): Promise<MessageRow[]> {
  const qs = new URLSearchParams({ sequenceId, per_page: "100", ...(status ? { status } : {}) });
  const res = await api.get(`/api/v1/emailer_messages/search?${qs}`);
  expect(res.status()).toBe(200);
  return (await res.json()).emailer_messages;
}

export async function enrollmentStatus(api: APIRequestContext, sequenceId: string, contactId: string) {
  const res = await api.get(`/api/v1/emailer_campaigns/${sequenceId}/enrollments?per_page=100`);
  const body = await res.json();
  return body.enrollments.find((e: { contact: { id: string } }) => e.contact.id === contactId)?.status as
    | string
    | undefined;
}

/** Move an enrollment's next run into the past so the next run treats it as due. */
export async function makeDue(sequenceId: string) {
  await pg().query(
    "update enrollment set next_run_at = now() - interval '1 minute' where sequence_id = $1 and next_run_at is not null",
    [sequenceId],
  );
}

export async function acmeCompanyId(): Promise<string> {
  const { rows } = await pg().query<{ id: string }>(
    "select id from company where organization_id = $1 order by created_at limit 1",
    [await orgId("acme")],
  );
  return rows[0].id;
}

export async function userId(email: string): Promise<string> {
  const { rows } = await pg().query<{ id: string }>('select id from "user" where email = $1', [email]);
  return rows[0].id;
}

/* -------------------------------------------------------------------------- */
/* Fresh accounts and workspaces                                              */
/* -------------------------------------------------------------------------- */

async function signUp(prefix: string): Promise<{ email: string; api: APIRequestContext }> {
  const email = `${uniq(prefix)}@example.com`.toLowerCase();
  const api = await request.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { origin: BASE_URL } });
  const res = await api.post("/api/auth/sign-up/email", {
    data: { email, password: PASSWORD, name: `Fresh ${prefix}` },
  });
  expect(res.status(), await res.text()).toBe(200);
  return { email, api };
}

/** A new account invited into Acme with `role`, signed in. */
export async function freshAcmeMember(role: "member" | "manager" | "viewer" = "member") {
  const fresh = await signUp(`wpc-${role}`);
  const inviter = await owner();
  const inv = await inviter.post("/api/v1/users/invite", { data: { email: fresh.email, role } });
  expect(inv.status(), await inv.text()).toBe(201);
  const invitationId = (await inv.json()).invitation.id as string;
  const acc = await fresh.api.post("/api/auth/organization/accept-invitation", { data: { invitationId } });
  expect(acc.status(), await acc.text()).toBe(200);
  // A fresh session context so the active workspace is set by sign-in.
  const api = await apiAs(fresh.email);
  return { email: fresh.email, api, userId: await userId(fresh.email) };
}

/** Make the account "went through onboarding, never accepted the anti-spam acknowledgement". */
export async function setOnboardedWithoutConsent(organizationSlug: "acme" | "globex", uid: string) {
  const org = await orgId(organizationSlug);
  await pg().query(
    `insert into onboarding_state (id, organization_id, user_id, finished_at, completed_steps, anti_spam_accepted_at)
     values (gen_random_uuid()::text, $1, $2, now(), '{email_skipped}', null)
     on conflict (organization_id, user_id)
     do update set finished_at = now(), completed_steps = '{email_skipped}', anti_spam_accepted_at = null`,
    [org, uid],
  );
}

/** A brand-new workspace (so workspace-wide policies can be changed safely) with a ready owner. */
export async function freshWorkspace() {
  const owner = await signUp("wpc-ws");
  const res = await owner.api.post("/api/v1/workspaces/register", { data: { workspaceName: uniq("WPC") } });
  expect(res.status(), await res.text()).toBe(201);
  const organizationId = (await res.json()).workspace.id as string;
  const accept = await owner.api.post("/api/v1/consents/anti-spam", { data: { accepted: true } });
  expect(accept.status(), await accept.text()).toBe(200);
  return { api: owner.api, email: owner.email, organizationId, userId: await userId(owner.email) };
}

export async function setPolicy(organizationId: string, policy: Record<string, unknown>) {
  const columns: Record<string, string> = {
    restrictUnverified: "restrict_unverified",
    restrictCatchAll: "restrict_catch_all",
    requireSignature: "require_signature",
    gradualRamp: "gradual_ramp",
    bounceGuard: "bounce_guard",
    bounceThreshold: "bounce_threshold",
    workspaceDailyLimit: "workspace_daily_limit",
  };
  const entries = Object.entries(policy);
  const cols = entries.map(([k]) => columns[k]);
  const values = entries.map(([, v]) => v);
  await pg().query(
    `insert into sending_policy (organization_id, ${cols.join(", ")}) values ($1, ${cols.map((_, i) => `$${i + 2}`).join(", ")})
     on conflict (organization_id) do update set ${cols.map((c, i) => `${c} = $${i + 2}`).join(", ")}`,
    [organizationId, ...values],
  );
}

/** A contact in any workspace (by organization id). */
export async function contactIn(
  organizationId: string,
  fields: { firstName?: string; email?: string; emailStatus?: string; stage?: string; companyId?: string | null } = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await pg().query(
    `insert into contact (id, organization_id, first_name, last_name, title, email, email_status, stage, company_id, source)
     values ($1, $2, $3, 'Person', 'Head of testing', $4, $5, $6, $7, 'test')`,
    [
      id,
      organizationId,
      fields.firstName ?? "Robin",
      fields.email ?? `${uniq("c")}@example.test`,
      fields.emailStatus ?? "valid",
      fields.stage ?? "new",
      fields.companyId ?? null,
    ],
  );
  return id;
}

export async function companyIn(organizationId: string, stage = "cold"): Promise<string> {
  const id = crypto.randomUUID();
  const tag = uniq("co");
  await pg().query(
    "insert into company (id, organization_id, name, domain, stage, source) values ($1, $2, $3, $4, $5, 'test')",
    [id, organizationId, `Company ${tag}`, `${tag}.example.test`, stage],
  );
  return id;
}

/* -------------------------------------------------------------------------- */
/* Mailpit details                                                            */
/* -------------------------------------------------------------------------- */

const MAILPIT = process.env.MAILPIT_URL ?? "http://localhost:48026";

export interface MailpitFull {
  Subject: string;
  Text: string;
  HTML: string;
  To: { Address: string }[];
  Cc: { Address: string }[] | null;
  Bcc: { Address: string }[] | null;
  MessageID: string;
}

export async function mailpitFull(id: string): Promise<MailpitFull> {
  const ctx = await request.newContext({ baseURL: MAILPIT });
  const res = await ctx.get(`/api/v1/message/${id}`);
  expect(res.ok()).toBeTruthy();
  return res.json();
}
