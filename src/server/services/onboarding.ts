import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { HOME_LAYOUTS, ONBOARDING_GOALS, ONBOARDING_ROLES, TEAM_SIZES } from "@/lib/onboarding";
import { can, type Permission, type Role } from "@/lib/rbac/permissions";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { forbidden } from "@/server/http/errors";

export interface OnboardingStateDto {
  /** False when the person never went through onboarding in this workspace (seeded or older accounts). */
  exists: boolean;
  role: string | null;
  teamSize: string | null;
  goals: string[];
  completedSteps: string[];
  finishedAt: string | null;
  hubDismissedAt: string | null;
  antiSpamAcceptedAt: string | null;
  homeLayout: (typeof HOME_LAYOUTS)[number];
}

export const onboardingPatchSchema = z
  .object({
    role: z.enum(ONBOARDING_ROLES).optional(),
    teamSize: z.enum(TEAM_SIZES).optional(),
    goals: z.array(z.enum(ONBOARDING_GOALS)).max(ONBOARDING_GOALS.length).optional(),
    /** Ticking the anti-spam acknowledgement; stored with its timestamp as consent evidence. */
    antiSpamAccepted: z.literal(true).optional(),
    /** Finish the flow ("Connect email" or "Skip for now"). */
    finished: z.literal(true).optional(),
    /** Which way the flow ended, kept as a completed step: connected an email or skipped. */
    outcome: z.enum(["email_connected", "email_skipped"]).optional(),
    hubDismissed: z.boolean().optional(),
    homeLayout: z.enum(HOME_LAYOUTS).optional(),
  })
  .strict();

export type OnboardingPatch = z.infer<typeof onboardingPatchSchema>;

type Row = typeof schema.onboardingState.$inferSelect;

function toDto(row: Row | undefined): OnboardingStateDto {
  const layout = HOME_LAYOUTS.find((l) => l === row?.homeLayout) ?? "getting_started";
  return {
    exists: Boolean(row),
    role: row?.role ?? null,
    teamSize: row?.teamSize ?? null,
    goals: row?.goals ?? [],
    completedSteps: row?.completedSteps ?? [],
    finishedAt: row?.finishedAt?.toISOString() ?? null,
    hubDismissedAt: row?.hubDismissedAt?.toISOString() ?? null,
    antiSpamAcceptedAt: row?.antiSpamAcceptedAt?.toISOString() ?? null,
    homeLayout: layout,
  };
}

/** Onboarding is personal: API keys have no person behind them. */
function ownerOf(actor: Actor): string {
  if (actor.kind !== "user" || !actor.userId) throw forbidden("Onboarding belongs to a signed-in person.");
  return actor.userId;
}

async function rowFor(organizationId: string, userId: string): Promise<Row | undefined> {
  const [row] = await db
    .select()
    .from(schema.onboardingState)
    .where(and(eq(schema.onboardingState.organizationId, organizationId), eq(schema.onboardingState.userId, userId)))
    .limit(1);
  return row;
}

export async function getOnboarding(actor: Actor): Promise<OnboardingStateDto> {
  return toDto(await rowFor(actor.organizationId, ownerOf(actor)));
}

/** Home layout and hub state for a page, without throwing for people who have no row. */
export async function onboardingFor(organizationId: string, userId: string): Promise<OnboardingStateDto> {
  return toDto(await rowFor(organizationId, userId));
}

/**
 * Start the flow for someone new to a workspace (after registering a workspace or accepting an
 * invitation). Idempotent. Viewers can't send or change data, so they skip it: their row is
 * created already finished.
 */
export async function startOnboarding(organizationId: string, userId: string, role: Role): Promise<void> {
  await db
    .insert(schema.onboardingState)
    .values({ organizationId, userId, finishedAt: role === "viewer" ? new Date() : null })
    .onConflictDoNothing();
}

/** True when the person started onboarding in this workspace and hasn't finished or skipped it. */
export async function needsOnboarding(organizationId: string, userId: string, role: Role): Promise<boolean> {
  if (role === "viewer") return false;
  const row = await rowFor(organizationId, userId);
  return Boolean(row && !row.finishedAt);
}

export async function updateOnboarding(actor: Actor, patch: OnboardingPatch): Promise<OnboardingStateDto> {
  const userId = ownerOf(actor);
  const now = new Date();
  const existing = await rowFor(actor.organizationId, userId);
  const set: Partial<typeof schema.onboardingState.$inferInsert> = {};
  if (patch.role !== undefined) set.role = patch.role;
  if (patch.teamSize !== undefined) set.teamSize = patch.teamSize;
  if (patch.goals !== undefined) set.goals = [...new Set(patch.goals)];
  if (patch.antiSpamAccepted) set.antiSpamAcceptedAt = existing?.antiSpamAcceptedAt ?? now;
  if (patch.finished) set.finishedAt = existing?.finishedAt ?? now;
  if (patch.outcome) set.completedSteps = [...new Set([...(existing?.completedSteps ?? []), patch.outcome])];
  if (patch.hubDismissed !== undefined) set.hubDismissedAt = patch.hubDismissed ? now : null;
  if (patch.homeLayout !== undefined) set.homeLayout = patch.homeLayout;

  if (!existing) {
    // Someone who never started the flow (seeded or older accounts) only saves preferences:
    // the row is created finished so it never sends them to onboarding.
    await db
      .insert(schema.onboardingState)
      .values({ organizationId: actor.organizationId, userId, finishedAt: now, ...set })
      .onConflictDoNothing();
  } else if (Object.keys(set).length) {
    await db.update(schema.onboardingState).set(set).where(eq(schema.onboardingState.id, existing.id));
  }
  return getOnboarding(actor);
}

/* -------------------------------------------------------------------------- */
/* Getting-started checklist, computed from real data                         */
/* -------------------------------------------------------------------------- */

export interface ChecklistStep {
  id: string;
  /** Bold action, then the rest of the sentence. */
  action: string;
  description: string;
  cta: string;
  href: string;
  done: boolean;
}

export interface ChecklistCard {
  id: string;
  title: string;
  description: string;
  steps: ChecklistStep[];
}

export interface GettingStarted {
  cards: ChecklistCard[];
  completed: number;
  total: number;
  /** 0–100, rounded. */
  percent: number;
}

interface StepDef extends Omit<ChecklistStep, "done"> {
  permission: Permission;
  flag: keyof ProgressFlags;
}

interface ProgressFlags {
  savedContact: boolean;
  createdList: boolean;
  savedCompany: boolean;
  savedSearch: boolean;
  mailbox: boolean;
  signature: boolean;
  policyReviewed: boolean;
  sequence: boolean;
  enrolled: boolean;
  sequenceActive: boolean;
  dealCreated: boolean;
  taskCompleted: boolean;
}

const CARDS: { id: string; title: string; description: string; steps: StepDef[] }[] = [
  {
    id: "prospects",
    title: "Start reaching the right prospects",
    description: "Find people and companies that match your ideal customer profile.",
    steps: [
      {
        id: "save_contact",
        action: "Save a contact",
        description: "to start building your pipeline",
        cta: "Save a prospect",
        href: "/dashboard/people",
        permission: "contact:create",
        flag: "savedContact",
      },
      {
        id: "create_list",
        action: "Create a list",
        description: "to keep your prospects organised",
        cta: "Create a list",
        href: "/dashboard/lists",
        permission: "list:create",
        flag: "createdList",
      },
      {
        id: "save_company",
        action: "Save target companies",
        description: "to find the right people inside them",
        cta: "Save a company",
        href: "/dashboard/companies",
        permission: "company:create",
        flag: "savedCompany",
      },
      {
        id: "save_search",
        action: "Save your search",
        description: "and get notified when new people match your audience",
        cta: "Save a search",
        href: "/dashboard/people",
        permission: "savedsearch:create",
        flag: "savedSearch",
      },
    ],
  },
  {
    id: "inbox",
    title: "Get your inbox ready to send",
    description: "Make sure your emails land in the inbox.",
    steps: [
      {
        id: "connect_mailbox",
        action: "Connect your email",
        description: "so sequences send from a mailbox you own",
        cta: "Connect mailbox",
        href: "/dashboard/mailboxes?new=1",
        permission: "mailbox:create",
        flag: "mailbox",
      },
      {
        id: "add_signature",
        action: "Add a signature",
        description: "with your name and postal address to every send",
        cta: "Edit mailbox",
        href: "/dashboard/mailboxes",
        permission: "mailbox:update",
        flag: "signature",
      },
      {
        id: "review_protection",
        action: "Review sending protection",
        description: "to set bounce guard and sending limits",
        cta: "Review policies",
        href: "/dashboard/settings/deliverability/sending-protection",
        permission: "deliverability:manage",
        flag: "policyReviewed",
      },
    ],
  },
  {
    id: "outreach",
    title: "Scale your outreach",
    description: "Reach more of the right people with a multi-step sequence.",
    steps: [
      {
        id: "create_sequence",
        action: "Build a sequence",
        description: "of emails, calls and tasks",
        cta: "Create sequence",
        href: "/dashboard/sequences/new?ai=1",
        permission: "sequence:create",
        flag: "sequence",
      },
      {
        id: "enroll_contacts",
        action: "Add people to a sequence",
        description: "to start reaching them",
        cta: "Add people",
        href: "/dashboard/sequences",
        permission: "sequence:launch",
        flag: "enrolled",
      },
      {
        id: "activate_sequence",
        action: "Activate a sequence",
        description: "so it sends on its schedule",
        cta: "Activate",
        href: "/dashboard/sequences",
        permission: "sequence:launch",
        flag: "sequenceActive",
      },
    ],
  },
  {
    id: "meetings",
    title: "Turn activity into meetings",
    description: "Follow up on replies and track the deals they become.",
    steps: [
      {
        id: "complete_task",
        action: "Complete a task",
        description: "such as a follow-up call or email",
        cta: "Open tasks",
        href: "/dashboard/tasks",
        permission: "task:update",
        flag: "taskCompleted",
      },
      {
        id: "create_deal",
        action: "Create a deal",
        description: "to track a conversation that turned into an opportunity",
        cta: "Create deal",
        href: "/dashboard/deals",
        permission: "deal:create",
        flag: "dealCreated",
      },
    ],
  },
];

async function progressFlags(organizationId: string, userId: string): Promise<ProgressFlags> {
  const exists = (query: ReturnType<typeof sql>) => sql<boolean>`exists (${query})`;
  const [row] = await db
    .select({
      savedContact: exists(
        sql`select 1 from contact where organization_id = ${organizationId} and owner_id = ${userId}`,
      ),
      createdList: exists(
        sql`select 1 from list where organization_id = ${organizationId} and created_by_id = ${userId}`,
      ),
      savedCompany: exists(
        sql`select 1 from company where organization_id = ${organizationId} and owner_id = ${userId}`,
      ),
      savedSearch: exists(
        sql`select 1 from saved_search where organization_id = ${organizationId} and owner_id = ${userId}`,
      ),
      mailbox: exists(sql`select 1 from mailbox where organization_id = ${organizationId} and user_id = ${userId}`),
      signature: exists(
        sql`select 1 from mailbox where organization_id = ${organizationId} and user_id = ${userId}
            and coalesce(signature, '') <> ''`,
      ),
      policyReviewed: exists(sql`select 1 from sending_policy where organization_id = ${organizationId}`),
      sequence: exists(
        sql`select 1 from sequence where organization_id = ${organizationId} and created_by_id = ${userId}`,
      ),
      enrolled: exists(
        sql`select 1 from enrollment where organization_id = ${organizationId} and enrolled_by_id = ${userId}`,
      ),
      sequenceActive: exists(
        sql`select 1 from sequence where organization_id = ${organizationId} and created_by_id = ${userId}
            and status = 'active'`,
      ),
      dealCreated: exists(sql`select 1 from deal where organization_id = ${organizationId} and owner_id = ${userId}`),
      taskCompleted: exists(
        sql`select 1 from task where organization_id = ${organizationId} and assignee_id = ${userId}
            and status = 'completed'`,
      ),
    })
    .from(sql`(select 1) as one`);
  return row as ProgressFlags;
}

/** Which checklist cards each onboarding goal brings forward. */
const GOAL_CARDS: Record<string, string[]> = {
  outbound: ["prospects", "inbox", "outreach"],
  inbound: ["prospects", "meetings"],
  enrichment: ["prospects"],
  deal_execution: ["meetings"],
};

/**
 * The getting-started checklist for one person, limited to steps their role can take. Cards that
 * match the goals they picked during onboarding come first.
 */
export async function gettingStarted(
  organizationId: string,
  userId: string,
  role: Role,
  goals: readonly string[] = [],
): Promise<GettingStarted> {
  const flags = await progressFlags(organizationId, userId);
  const preferred = goals.flatMap((g) => GOAL_CARDS[g] ?? []);
  const rank = (id: string) => {
    const index = preferred.indexOf(id);
    return index === -1 ? preferred.length + CARDS.findIndex((c) => c.id === id) : index;
  };
  const ordered = [...CARDS].sort((a, b) => rank(a.id) - rank(b.id));
  const cards: ChecklistCard[] = ordered
    .map((card) => ({
      id: card.id,
      title: card.title,
      description: card.description,
      steps: card.steps
        .filter((step) => can(role, step.permission))
        .map(({ permission: _permission, flag, ...step }) => ({ ...step, done: Boolean(flags[flag]) })),
    }))
    .filter((card) => card.steps.length > 0);
  const steps = cards.flatMap((c) => c.steps);
  const completed = steps.filter((s) => s.done).length;
  const total = steps.length;
  return { cards, completed, total, percent: total ? Math.round((completed / total) * 100) : 100 };
}

/* -------------------------------------------------------------------------- */
/* Workspace setup (admin settings menu)                                      */
/* -------------------------------------------------------------------------- */

export interface WorkspaceSetup {
  steps: { id: string; label: string; href: string; done: boolean }[];
  percent: number;
}

export async function workspaceSetup(organizationId: string): Promise<WorkspaceSetup> {
  const [row] = await db
    .select({
      teammates: sql<boolean>`(select count(*) from member where organization_id = ${organizationId}) > 1
        or exists (select 1 from invitation where organization_id = ${organizationId})`,
      mailbox: sql<boolean>`exists (select 1 from mailbox where organization_id = ${organizationId})`,
      branded: sql<boolean>`exists (select 1 from organization where id = ${organizationId}
        and (brand_name is not null or brand_color is not null))`,
      domain: sql<boolean>`exists (select 1 from workspace_domain where organization_id = ${organizationId}
        and status = 'verified')`,
      optOuts: sql<boolean>`exists (select 1 from suppression where organization_id = ${organizationId})`,
    })
    .from(sql`(select 1) as one`);
  const steps = [
    { id: "teammates", label: "Invite your teammates", href: "/dashboard/settings/members", done: !!row?.teammates },
    { id: "mailbox", label: "Connect a mailbox", href: "/dashboard/mailboxes", done: !!row?.mailbox },
    { id: "branding", label: "Set your brand", href: "/dashboard/settings/branding", done: !!row?.branded },
    { id: "domain", label: "Verify a hostname", href: "/dashboard/settings/domains", done: !!row?.domain },
    {
      id: "opt-outs",
      label: "Load your do-not-contact list",
      href: "/dashboard/settings/do-not-contact",
      done: !!row?.optOuts,
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, percent: Math.round((done / steps.length) * 100) };
}
