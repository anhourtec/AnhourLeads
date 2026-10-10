import "server-only";

import { notFound, redirect } from "next/navigation";

import { can, type Permission } from "@/lib/rbac/permissions";
import type { Actor } from "@/server/auth/actor";
import { type AppContext, getAppContext } from "@/server/auth/context";
import { HttpError } from "@/server/http/errors";

/**
 * Actor for a dashboard Server Component. Redirects to the unauthorized page when the signed-in
 * user has no workspace or their role lacks `permission`, mirroring what route() enforces for the API.
 */
export async function pageActor(permission: Permission): Promise<{ actor: Actor; context: AppContext }> {
  const context = await getAppContext();
  const workspace = context.workspace;
  if (!workspace || !can(workspace.role, permission)) redirect("/unauthorized");
  const actor: Actor = {
    kind: "user",
    userId: context.user.id,
    apiKeyId: null,
    organizationId: workspace.organizationId,
    role: workspace.role,
    isPlatformAdmin: context.user.isPlatformAdmin,
    tenant: context.tenant,
  };
  return { actor, context };
}

/** Await a service call, turning its 404 (missing or out-of-scope id) into the not-found page. */
export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
}
