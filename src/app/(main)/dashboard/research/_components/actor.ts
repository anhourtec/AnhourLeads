import "server-only";

import type { Actor } from "@/server/auth/actor";
import type { AppContext } from "@/server/auth/context";

/** The acting member for the research pages, so they can call services directly. */
export function researchActor(context: AppContext): Actor | null {
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
