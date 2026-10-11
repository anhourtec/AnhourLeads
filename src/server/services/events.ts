import "server-only";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/server/db";
import { log } from "@/server/log";

import { applyEngageRules } from "./engage-rules";
import { applyStageTriggers } from "./stage-triggers";
import { enqueueWorkflowRuns } from "./workflow-engine";

/**
 * Record events, one entry point shared by every feature.
 *
 * Every meaningful change to a record (email sent / opened / replied / bounced, stage change,
 * note, task, enrollment, list membership…) goes through recordEvent(). It writes the activity
 * timeline row, then lets the contact-stage triggers and workflow triggers react. Handlers never
 * throw into the caller: failures are logged.
 */
export type RecordEventType =
  | "contact_created"
  | "contact_updated"
  | "contact_added_to_list"
  | "contact_added_to_sequence"
  | "contact_finished_sequence"
  | "contact_finished_step"
  | "email_sent"
  | "email_delivered"
  | "email_opened"
  | "email_clicked"
  | "email_replied"
  | "email_bounced"
  | "email_not_sent"
  | "email_unsubscribed"
  | "spam_blocked"
  | "marked_interested"
  | "contact_unresponsive"
  | "call_logged"
  | "task_created"
  | "task_completed"
  | "note_added"
  | "stage_changed"
  | "deal_created"
  | "deal_stage_changed"
  | "meeting_booked";

export interface RecordEvent {
  organizationId: string;
  type: RecordEventType;
  summary: string;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordEvent(event: RecordEvent): Promise<void> {
  try {
    await db.insert(schema.activity).values({
      organizationId: event.organizationId,
      contactId: event.contactId ?? null,
      companyId: event.companyId ?? null,
      dealId: event.dealId ?? null,
      type: event.type,
      summary: event.summary,
      metadata: event.metadata,
      actorUserId: event.actorUserId ?? null,
    });
    // Keep "last activity" cheap to filter and sort on.
    const now = new Date();
    if (event.contactId) {
      await db
        .update(schema.contact)
        .set({ lastActivityAt: now })
        .where(and(eq(schema.contact.id, event.contactId), eq(schema.contact.organizationId, event.organizationId)));
    }
    if (event.companyId) {
      await db
        .update(schema.company)
        .set({ lastActivityAt: now })
        .where(and(eq(schema.company.id, event.companyId), eq(schema.company.organizationId, event.organizationId)));
    }
  } catch (error) {
    log.error("activity write failed", { component: "events", type: event.type, error });
  }
  for (const handler of [applyStageTriggers, enqueueWorkflowRuns, applyEngageRules]) {
    try {
      await handler(event);
    } catch (error) {
      log.error("event handler failed", { component: "events", type: event.type, error });
    }
  }
}
