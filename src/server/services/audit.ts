import "server-only";

import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { log } from "@/server/log";

/** Record who did what. Never pass secrets in metadata. Failures are logged, never thrown. */
export async function audit(
  actor: Pick<Actor, "organizationId" | "userId" | "apiKeyId">,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await db.insert(schema.auditLog).values({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      actorApiKeyId: actor.apiKeyId,
      action,
      entityType,
      entityId,
      metadata,
    });
  } catch (error) {
    log.error("audit write failed", { component: "audit", action, error });
  }
}
