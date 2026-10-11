import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/server/db";

import type { RecordEvent } from "./events";

/**
 * Sequence default triggers that react to events recorded elsewhere. Today: a booked meeting
 * finishes the contact in every sequence they are active or paused in, and holds back unsent emails.
 */
export async function applyEngageRules(event: RecordEvent): Promise<void> {
  if (event.type !== "meeting_booked" || !event.contactId) return;
  const finished = await db
    .update(schema.enrollment)
    .set({ status: "finished", nextRunAt: null })
    .where(
      and(
        eq(schema.enrollment.organizationId, event.organizationId),
        eq(schema.enrollment.contactId, event.contactId),
        inArray(schema.enrollment.status, ["active", "paused"]),
      ),
    )
    .returning({ id: schema.enrollment.id });
  if (!finished.length) return;
  await db
    .update(schema.outboundMessage)
    .set({ status: "blocked", blockedReason: "A meeting was booked, so the sequence finished." })
    .where(
      and(
        inArray(
          schema.outboundMessage.enrollmentId,
          finished.map((f) => f.id),
        ),
        inArray(schema.outboundMessage.status, ["pending_review", "queued", "failed"]),
      ),
    );
}
