/**
 * Contact and account stage defaults, stage trigger events and label helpers. Safe for client
 * components. Workspaces rename stages and mark them protected (settings → contact stages); the
 * keys themselves are fixed enums.
 */
import {
  COMPANY_STAGE_LABELS,
  COMPANY_STAGES,
  CONTACT_STAGE_LABELS,
  CONTACT_STAGES,
  type CompanyStage,
  type ContactStage,
} from "./records-vocabulary";

export type RecordStageEntity = "contact" | "company";

export interface RecordStageView {
  key: string;
  label: string;
  position: number;
  /** Event triggers don't override this stage when someone set it by hand. */
  protected: boolean;
}

/** Stages marked * in the reference: set by people, not overwritten by event triggers. */
export const PROTECTED_BY_DEFAULT: ContactStage[] = ["interested", "not_interested", "do_not_contact", "changed_job"];

export function defaultRecordStages(entity: RecordStageEntity): RecordStageView[] {
  if (entity === "contact") {
    return CONTACT_STAGES.map((key, position) => ({
      key,
      label: CONTACT_STAGE_LABELS[key],
      position,
      protected: PROTECTED_BY_DEFAULT.includes(key),
    }));
  }
  return COMPANY_STAGES.map((key, position) => ({
    key,
    label: COMPANY_STAGE_LABELS[key as CompanyStage],
    position,
    protected: false,
  }));
}

export const STAGE_TRIGGER_EVENTS = [
  "prospect_created",
  "email_delivered",
  "email_bounced",
  "spam_blocked",
  "unsubscribed",
  "replied",
  "interested",
  "unresponsive",
] as const;
export type StageTriggerEvent = (typeof STAGE_TRIGGER_EVENTS)[number];

export const STAGE_TRIGGER_LABELS: Record<StageTriggerEvent, { label: string; description: string }> = {
  prospect_created: { label: "Person created", description: "Someone is added or saved to the workspace." },
  email_delivered: { label: "Email delivered", description: "An email from a sequence reaches their inbox." },
  email_bounced: { label: "Email bounced", description: "The receiving server rejects the address." },
  spam_blocked: { label: "Blocked as spam", description: "The receiving server refuses the message as spam." },
  unsubscribed: { label: "Unsubscribed", description: "They use the unsubscribe link." },
  replied: { label: "Replied", description: "They reply to any email." },
  interested: { label: "Marked interested", description: "A reply or meeting is marked as interested." },
  unresponsive: {
    label: "No response after the last step",
    description: "A sequence finishes without a reply (days set in the sequence ruleset).",
  },
};

export const DEFAULT_STAGE_TRIGGERS: Record<StageTriggerEvent, ContactStage | null> = {
  prospect_created: "new",
  email_delivered: "contacted",
  email_bounced: "bad_data",
  spam_blocked: null,
  unsubscribed: "do_not_contact",
  replied: "replied",
  interested: "interested",
  unresponsive: "unresponsive",
};

/** Label for a stage key from a workspace's label map, falling back to the default label. */
export function stageLabel(labels: Record<string, string> | undefined, key: string | null | undefined): string {
  if (!key) return "";
  const own = labels?.[key];
  if (own) return own;
  if ((CONTACT_STAGES as readonly string[]).includes(key)) return CONTACT_STAGE_LABELS[key as ContactStage];
  if ((COMPANY_STAGES as readonly string[]).includes(key)) return COMPANY_STAGE_LABELS[key as CompanyStage];
  return key;
}
