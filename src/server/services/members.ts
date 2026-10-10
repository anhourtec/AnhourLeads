import "server-only";

import { and, asc, desc, eq, gt, ilike, or, type SQL, sql } from "drizzle-orm";
import { z } from "zod";

import {
  can,
  isRole,
  outranksOrEquals,
  PERMISSIONS,
  type Permission,
  ROLE_LABELS,
  ROLES,
  type Role,
} from "@/lib/rbac/permissions";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { sendMail } from "@/server/email/mailer";
import { env } from "@/server/env";
import { conflict, forbidden, HttpError, notFound } from "@/server/http/errors";
import type { Page } from "@/server/http/route";
import { log } from "@/server/log";

import { audit } from "./audit";
import { normaliseEmail } from "./suppressions";
import { randomUUID } from "node:crypto";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const memberSearchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  role: z.enum(ROLES).optional(),
});
export const inviteSchema = z.object({
  email: z.string().trim().min(1).max(320),
  role: z.enum(ROLES).default("member"),
});
export const roleChangeSchema = z.object({ role: z.enum(ROLES) });

export interface MemberDto {
  id: string;
  memberId: string;
  name: string;
  email: string;
  image: string | null;
  role: Role;
  joinedAt: string;
}

export interface InvitationDto {
  id: string;
  email: string;
  role: Role;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  inviter: { id: string; name: string } | null;
}

/** Members can be managed only by people signed in, never by API keys. */
function requireUserActor(actor: Actor): asserts actor is Actor & { userId: string } {
  if (actor.kind !== "user" || !actor.userId) throw forbidden("API keys can't manage workspace members.");
}

export async function searchMembers(actor: Actor, input: z.infer<typeof memberSearchSchema>, page: Page) {
  const where: SQL[] = [eq(schema.member.organizationId, actor.organizationId)];
  if (input.q) {
    const term = `%${input.q.replace(/[%_\\]/g, "\\$&")}%`;
    const match = or(ilike(schema.user.name, term), ilike(schema.user.email, term));
    if (match) where.push(match);
  }
  if (input.role) where.push(eq(schema.member.role, input.role));
  const condition = and(...where);
  const [rows, [{ count }]] = await Promise.all([
    db
      .select({
        id: schema.user.id,
        memberId: schema.member.id,
        name: schema.user.name,
        email: schema.user.email,
        image: schema.user.image,
        role: schema.member.role,
        joinedAt: schema.member.createdAt,
      })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(condition)
      .orderBy(
        sql`case ${schema.member.role} when 'owner' then 0 when 'admin' then 1 when 'manager' then 2 when 'member' then 3 else 4 end`,
        asc(schema.user.name),
      )
      .limit(page.perPage)
      .offset(page.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.member)
      .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
      .where(condition),
  ]);
  const users: MemberDto[] = rows.map((r) => ({
    ...r,
    role: isRole(r.role) ? r.role : "viewer",
    joinedAt: r.joinedAt.toISOString(),
  }));
  return { users, total: count };
}

export async function apiProfile(actor: Actor) {
  const [org] = await db
    .select({ id: schema.organization.id, name: schema.organization.name, slug: schema.organization.slug })
    .from(schema.organization)
    .where(eq(schema.organization.id, actor.organizationId))
    .limit(1);
  const [user] = actor.userId
    ? await db
        .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, actor.userId))
        .limit(1)
    : [];
  const [key] = actor.apiKeyId
    ? await db
        .select({ id: schema.apiKey.id, name: schema.apiKey.name, prefix: schema.apiKey.prefix })
        .from(schema.apiKey)
        .where(eq(schema.apiKey.id, actor.apiKeyId))
        .limit(1)
    : [];
  const permissions: Permission[] = PERMISSIONS.filter((p) => can(actor.role, p));
  return {
    authenticatedAs: actor.kind,
    user: actor.kind === "user" ? (user ?? null) : null,
    apiKey: key ?? null,
    workspace: org ?? null,
    role: actor.role,
    roleLabel: ROLE_LABELS[actor.role],
    permissions,
  };
}

async function membership(actor: Actor, userId: string) {
  const [row] = await db
    .select({ id: schema.member.id, role: schema.member.role, name: schema.user.name, email: schema.user.email })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(and(eq(schema.member.organizationId, actor.organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!row) throw notFound("Member not found.");
  return { ...row, role: isRole(row.role) ? row.role : ("viewer" as Role) };
}

async function ownerCount(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.role, "owner")));
  return row?.count ?? 0;
}

/** Shared guard rails for role changes and invitations. */
function assertCanGrant(actor: Actor, role: Role) {
  if (role === "owner" && actor.role !== "owner") throw forbidden("Only an owner can make someone an owner.");
  if (!outranksOrEquals(actor.role, role)) throw forbidden("You can't grant a role above your own.");
}

export async function changeRole(actor: Actor, userId: string, role: Role): Promise<MemberDto> {
  requireUserActor(actor);
  const target = await membership(actor, userId);
  if (!outranksOrEquals(actor.role, target.role)) throw forbidden("You can't change the role of someone above you.");
  if (target.role === "owner" && actor.role !== "owner") throw forbidden("Only an owner can change an owner's role.");
  assertCanGrant(actor, role);
  if (target.role === role) return (await getMember(actor, userId)) as MemberDto;
  if (target.role === "owner" && (await ownerCount(actor.organizationId)) <= 1) {
    throw conflict("A workspace needs at least one owner. Make someone else an owner first.");
  }
  await db.update(schema.member).set({ role }).where(eq(schema.member.id, target.id));
  await audit(actor, "member.role_change", "member", userId, { from: target.role, to: role });
  return (await getMember(actor, userId)) as MemberDto;
}

export async function getMember(actor: Actor, userId: string): Promise<MemberDto | null> {
  const [row] = await db
    .select({
      id: schema.user.id,
      memberId: schema.member.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
      role: schema.member.role,
      joinedAt: schema.member.createdAt,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(and(eq(schema.member.organizationId, actor.organizationId), eq(schema.member.userId, userId)))
    .limit(1);
  if (!row) return null;
  return { ...row, role: isRole(row.role) ? row.role : "viewer", joinedAt: row.joinedAt.toISOString() };
}

export async function removeMember(actor: Actor, userId: string): Promise<void> {
  requireUserActor(actor);
  const target = await membership(actor, userId);
  if (!outranksOrEquals(actor.role, target.role)) throw forbidden("You can't remove someone above you.");
  if (target.role === "owner" && actor.role !== "owner") throw forbidden("Only an owner can remove an owner.");
  if (target.role === "owner" && (await ownerCount(actor.organizationId)) <= 1) {
    throw conflict("A workspace needs at least one owner. Make someone else an owner first.");
  }
  await db.transaction(async (tx) => {
    await tx.delete(schema.member).where(eq(schema.member.id, target.id));
    await tx
      .update(schema.session)
      .set({ activeOrganizationId: null })
      .where(and(eq(schema.session.userId, userId), eq(schema.session.activeOrganizationId, actor.organizationId)));
  });
  await audit(actor, "member.remove", "member", userId, { role: target.role, email: target.email });
}

const invitationColumns = {
  id: schema.invitation.id,
  email: schema.invitation.email,
  role: schema.invitation.role,
  status: schema.invitation.status,
  expiresAt: schema.invitation.expiresAt,
  createdAt: schema.invitation.createdAt,
  inviterId: schema.invitation.inviterId,
  inviterName: schema.user.name,
};

function invitationDto(row: {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
  inviterId: string;
  inviterName: string | null;
}): InvitationDto {
  return {
    id: row.id,
    email: row.email,
    role: isRole(row.role) ? row.role : "viewer",
    status: row.status,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    inviter: row.inviterName ? { id: row.inviterId, name: row.inviterName } : null,
  };
}

export async function listInvitations(actor: Actor): Promise<InvitationDto[]> {
  const rows = await db
    .select(invitationColumns)
    .from(schema.invitation)
    .leftJoin(schema.user, eq(schema.user.id, schema.invitation.inviterId))
    .where(
      and(
        eq(schema.invitation.organizationId, actor.organizationId),
        eq(schema.invitation.status, "pending"),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(schema.invitation.createdAt));
  return rows.map(invitationDto);
}

export async function inviteMember(actor: Actor, input: z.infer<typeof inviteSchema>): Promise<InvitationDto> {
  requireUserActor(actor);
  const email = normaliseEmail(input.email);
  if (!email) {
    throw new HttpError(422, "Some fields are invalid.", [{ path: "email", message: "Enter a valid email address." }]);
  }
  assertCanGrant(actor, input.role);

  const [existingMember] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(and(eq(schema.member.organizationId, actor.organizationId), eq(sql`lower(${schema.user.email})`, email)))
    .limit(1);
  if (existingMember) throw conflict("That person is already a member of this workspace.");

  const [pending] = await db
    .select({ id: schema.invitation.id })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, actor.organizationId),
        eq(sql`lower(${schema.invitation.email})`, email),
        eq(schema.invitation.status, "pending"),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (pending) throw conflict("That address already has a pending invitation. Cancel it to send a new one.");

  const [org] = await db
    .select({ name: schema.organization.name, brandName: schema.organization.brandName })
    .from(schema.organization)
    .where(eq(schema.organization.id, actor.organizationId))
    .limit(1);
  const [inviter] = await db
    .select({ name: schema.user.name })
    .from(schema.user)
    .where(eq(schema.user.id, actor.userId))
    .limit(1);

  const id = randomUUID();
  await db.insert(schema.invitation).values({
    id,
    organizationId: actor.organizationId,
    email,
    role: input.role,
    status: "pending",
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
    inviterId: actor.userId,
  });

  // Same message as the auth instance's sendInvitationEmail, sent from the host the inviter is on.
  const brand = org?.brandName ?? org?.name ?? "your workspace";
  const inviterName = inviter?.name ?? "A teammate";
  const origin = `${env().APP_PROTOCOL}://${actor.tenant.host}`;
  const sent = await sendMail({
    to: email,
    fromName: brand,
    subject: `${inviterName} invited you to ${brand}`,
    text: `${inviterName} invited you to join ${brand} as ${ROLE_LABELS[input.role].toLowerCase()}.\n\nAccept the invitation: ${origin}/auth/accept-invite/${id}\n\nThe link expires in 7 days.`,
  });
  if (!sent) log.warn("invitation email not delivered", { component: "members", invitationId: id });

  await audit(actor, "member.invite", "invitation", id, { email, role: input.role, emailSent: sent });
  const [row] = await db
    .select(invitationColumns)
    .from(schema.invitation)
    .leftJoin(schema.user, eq(schema.user.id, schema.invitation.inviterId))
    .where(eq(schema.invitation.id, id))
    .limit(1);
  return invitationDto(row);
}

export async function cancelInvitation(actor: Actor, id: string): Promise<void> {
  requireUserActor(actor);
  const [row] = await db
    .select({ role: schema.invitation.role, email: schema.invitation.email })
    .from(schema.invitation)
    .where(
      and(
        eq(schema.invitation.organizationId, actor.organizationId),
        eq(schema.invitation.id, id),
        eq(schema.invitation.status, "pending"),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Invitation not found.");
  if (isRole(row.role) && !outranksOrEquals(actor.role, row.role)) {
    throw forbidden("You can't cancel an invitation for a role above your own.");
  }
  await db.update(schema.invitation).set({ status: "canceled" }).where(eq(schema.invitation.id, id));
  await audit(actor, "member.invite_cancel", "invitation", id, { email: row.email, role: row.role });
}
