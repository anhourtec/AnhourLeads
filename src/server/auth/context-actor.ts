import "server-only";

import type { Actor } from "./actor";
import type { AppContext } from "./context";

/**
 * The acting member for a Server Component, built from the page context, so pages can call
 * services directly. Null when the signed-in user has no workspace on this host.
 */
export function actorFromContext(context: AppContext): Actor | null {
  if (!context.workspace) return null;
  return {
    kind: "user",
    userId: context.user.id,
    apiKeyId: null,
    organizationId: context.workspace.organizationId,
    role: context.workspace.role,
    isPlatformAdmin: context.user.isPlatformAdmin,
    tenant: context.tenant,
  };
}
