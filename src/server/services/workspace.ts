import "server-only";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { ROLE_LABELS } from "@/lib/rbac/permissions";
import type { Actor } from "@/server/auth/actor";
import { dropAuth } from "@/server/auth/auth";
import { db, schema } from "@/server/db";
import { forbidden, HttpError, notFound } from "@/server/http/errors";
import { log } from "@/server/log";
import { invalidateBrand } from "@/server/tenancy/brand";
import { invalidateTenant } from "@/server/tenancy/host";

import { audit } from "./audit";

export const workspaceUpdateSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const workspaceDeleteSchema = z.object({ confirm: z.string() });

export async function getWorkspace(actor: Actor) {
  const [[row], [members]] = await Promise.all([
    db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
        createdAt: schema.organization.createdAt,
      })
      .from(schema.organization)
      .where(eq(schema.organization.id, actor.organizationId))
      .limit(1),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.member)
      .where(eq(schema.member.organizationId, actor.organizationId)),
  ]);
  if (!row) throw notFound("Workspace not found.");
  return {
    ...row,
    memberCount: members?.count ?? 0,
    createdAt: row.createdAt.toISOString(),
    role: actor.role,
    roleLabel: ROLE_LABELS[actor.role],
  };
}

export async function renameWorkspace(actor: Actor, name: string) {
  const before = await getWorkspace(actor);
  await db
    .update(schema.organization)
    .set({ name, updatedAt: new Date() })
    .where(eq(schema.organization.id, actor.organizationId));
  await invalidateBrand(actor.organizationId);
  await audit(actor, "workspace.update", "workspace", actor.organizationId, { from: before.name, to: name });
  return getWorkspace(actor);
}

/** Delete the workspace and everything in it. The caller must type the workspace name to confirm. */
export async function deleteWorkspace(actor: Actor, confirm: string) {
  if (actor.kind !== "user") throw forbidden("API keys can't delete a workspace.");
  const workspace = await getWorkspace(actor);
  if (confirm.trim() !== workspace.name) {
    throw new HttpError(422, "Some fields are invalid.", [
      { path: "confirm", message: "Type the workspace name exactly to confirm." },
    ]);
  }
  const hosts = await db
    .select({ hostname: schema.workspaceDomain.hostname })
    .from(schema.workspaceDomain)
    .where(eq(schema.workspaceDomain.organizationId, actor.organizationId));
  await db.transaction(async (tx) => {
    await tx
      .update(schema.session)
      .set({ activeOrganizationId: null })
      .where(eq(schema.session.activeOrganizationId, actor.organizationId));
    await tx.delete(schema.organization).where(eq(schema.organization.id, actor.organizationId));
  });
  for (const { hostname } of hosts) {
    dropAuth(hostname);
    await invalidateTenant(hostname);
  }
  await invalidateBrand(actor.organizationId);
  // The workspace's own audit trail goes with it, so the deletion is recorded in the server log.
  log.info("workspace deleted", {
    component: "workspace",
    organizationId: actor.organizationId,
    userId: actor.userId,
    name: workspace.name,
  });
  return { deleted: true };
}
