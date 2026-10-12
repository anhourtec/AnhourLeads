import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  DEFAULT_STAGE_TRIGGERS,
  STAGE_TRIGGER_EVENTS,
  STAGE_TRIGGER_LABELS,
  type StageTriggerEvent,
} from "@/lib/record-stages";
import { CONTACT_STAGES, type ContactStage } from "@/lib/records-vocabulary";
import type { Actor } from "@/server/auth/actor";
import { db, schema } from "@/server/db";
import { log } from "@/server/log";

import { audit } from "./audit";
import type { RecordEvent, RecordEventType } from "./events";
import { listRecordStages } from "./record-stages";
import { enqueueWorkflowRuns } from "./workflow-engine";

/**
 * Contact stage triggers (settings → contact stages → triggers): an event moves the contact to the
 * workspace's chosen stage, unless the contact's current stage is protected and was set by hand.
 */

const EVENT_TO_TRIGGER: Partial<Record<RecordEventType, StageTriggerEvent>> = {
  contact_created: "prospect_created",
  email_sent: "email_delivered",
  email_delivered: "email_delivered",
  email_bounced: "email_bounced",
  spam_blocked: "spam_blocked",
  email_unsubscribed: "unsubscribed",
  email_replied: "replied",
  marked_interested: "interested",
  contact_unresponsive: "unresponsive",
};

export interface StageTriggerView {
  event: StageTriggerEvent;
  label: string;
  description: string;
  stageKey: ContactStage | null;
  isDefault: boolean;
}

export async function triggerRules(organizationId: string): Promise<Record<StageTriggerEvent, ContactStage | null>> {
  const rows = await db
    .select({ event: schema.stageTrigger.event, stageKey: schema.stageTrigger.stageKey })
    .from(schema.stageTrigger)
    .where(eq(schema.stageTrigger.organizationId, organizationId));
  const rules = { ...DEFAULT_STAGE_TRIGGERS };
  for (const r of rows) {
    rules[r.event] =
      r.stageKey && (CONTACT_STAGES as readonly string[]).includes(r.stageKey) ? (r.stageKey as ContactStage) : null;
  }
  return rules;
}

export async function listStageTriggers(actor: Pick<Actor, "organizationId">): Promise<StageTriggerView[]> {
  const rules = await triggerRules(actor.organizationId);
  return STAGE_TRIGGER_EVENTS.map((event) => ({
    event,
    ...STAGE_TRIGGER_LABELS[event],
    stageKey: rules[event],
    isDefault: rules[event] === DEFAULT_STAGE_TRIGGERS[event],
  }));
}

export const stageTriggersUpdateSchema = z
  .object({
    triggers: z
      .array(z.object({ event: z.enum(STAGE_TRIGGER_EVENTS), stageKey: z.enum(CONTACT_STAGES).nullable() }).strict())
      .min(1)
      .max(STAGE_TRIGGER_EVENTS.length),
  })
  .strict();

export async function updateStageTriggers(actor: Actor, input: z.infer<typeof stageTriggersUpdateSchema>) {
  await db.transaction(async (tx) => {
    for (const t of input.triggers) {
      await tx
        .insert(schema.stageTrigger)
        .values({ organizationId: actor.organizationId, event: t.event, stageKey: t.stageKey })
        .onConflictDoUpdate({
          target: [schema.stageTrigger.organizationId, schema.stageTrigger.event],
          set: { stageKey: t.stageKey },
        });
    }
  });
  await audit(actor, "stage_triggers.update", "stage_trigger", null, {
    events: input.triggers.map((t) => t.event),
  });
  return listStageTriggers(actor);
}

/** True when the latest stage change of the contact was made by a person (not a trigger or workflow). */
async function lastChangeWasManual(organizationId: string, contactId: string): Promise<boolean> {
  const [last] = await db
    .select({ metadata: schema.activity.metadata })
    .from(schema.activity)
    .where(
      and(
        eq(schema.activity.organizationId, organizationId),
        eq(schema.activity.contactId, contactId),
        eq(schema.activity.type, "stage_changed"),
      ),
    )
    .orderBy(desc(schema.activity.occurredAt))
    .limit(1);
  return last?.metadata?.manual === true;
}

/** Called by recordEvent() for every event. Never throws (the hub logs failures anyway). */
export async function applyStageTriggers(event: RecordEvent): Promise<void> {
  const trigger = EVENT_TO_TRIGGER[event.type];
  if (!trigger || !event.contactId) return;
  const rules = await triggerRules(event.organizationId);
  const target = rules[trigger];
  if (!target) return;
  const [contact] = await db
    .select({ id: schema.contact.id, stage: schema.contact.stage, companyId: schema.contact.companyId })
    .from(schema.contact)
    .where(and(eq(schema.contact.organizationId, event.organizationId), eq(schema.contact.id, event.contactId)))
    .limit(1);
  if (!contact || contact.stage === target) return;
  // A new person starts in the configured stage; a stage given at creation (import, API) is kept.
  if (trigger === "prospect_created" && contact.stage !== "new") return;

  const stages = await listRecordStages(event.organizationId, "contact");
  const current = stages.find((s) => s.key === contact.stage);
  if (current?.protected && (await lastChangeWasManual(event.organizationId, contact.id))) {
    log.info("stage trigger skipped: protected stage set manually", {
      component: "stage-triggers",
      contactId: contact.id,
      trigger,
    });
    return;
  }

  const updated = await db
    .update(schema.contact)
    .set({ stage: target })
    .where(
      and(
        eq(schema.contact.organizationId, event.organizationId),
        eq(schema.contact.id, contact.id),
        eq(schema.contact.stage, contact.stage),
      ),
    )
    .returning({ id: schema.contact.id });
  if (!updated.length) return;
  const label = (key: string) => stages.find((s) => s.key === key)?.label ?? key;
  // Same two steps as recordEvent() (timeline row, then workflow triggers); the hub calls this module,
  // so it can't be called back from here.
  const changed: RecordEvent = {
    organizationId: event.organizationId,
    type: "stage_changed",
    summary: `Stage changed from ${label(contact.stage)} to ${label(target)} (${STAGE_TRIGGER_LABELS[trigger].label.toLowerCase()})`,
    contactId: contact.id,
    companyId: contact.companyId,
    actorUserId: null,
    metadata: { manual: false, cause: trigger, sourceEvent: event.type, from: contact.stage, to: target },
  };
  await db.insert(schema.activity).values({
    organizationId: changed.organizationId,
    contactId: changed.contactId,
    companyId: changed.companyId,
    type: changed.type,
    summary: changed.summary,
    metadata: changed.metadata,
    actorUserId: null,
  });
  await enqueueWorkflowRuns(changed);
}
