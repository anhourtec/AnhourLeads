import { Eye, Mail, MessageSquare, Phone, SquareCheck, ThumbsUp, UserPen, UserPlus } from "lucide-react";

import { isEmailStep, type StepType, type ThreadMode } from "@/lib/engage-constants";
import type { StepView } from "@/server/services/sequences";

/** Client-side draft of the ordered step list, compared against the saved one to detect changes. */

export interface VariantDraft {
  key: string;
  id?: string;
  label: string;
  subject: string;
  body: string;
  active: boolean;
}

export interface StepDraft {
  key: string;
  id?: string;
  type: StepType;
  waitDays: number;
  waitMinutes: number;
  enabled: boolean;
  threadMode: ThreadMode;
  /** Non-email steps and manual emails use these; automatic emails keep content in `variants`. */
  subject: string;
  body: string;
  /** Automatic emails always have at least one version ("A"). */
  variants: VariantDraft[];
}

export const STEP_ICONS: Record<StepType, typeof Mail> = {
  auto_email: Mail,
  manual_email: UserPen,
  call: Phone,
  task: SquareCheck,
  linkedin_connect: UserPlus,
  linkedin_message: MessageSquare,
  linkedin_view: Eye,
  linkedin_interact: ThumbsUp,
};

let counter = 0;
export const newKey = (prefix = "k") => `${prefix}-${Date.now().toString(36)}-${++counter}`;

export const VARIANT_LABELS = ["A", "B", "C", "D", "E"] as const;

export function nextVariantLabel(variants: VariantDraft[]): string {
  const used = new Set(variants.map((v) => v.label.toUpperCase()));
  return VARIANT_LABELS.find((l) => !used.has(l)) ?? `V${variants.length + 1}`;
}

export function toDrafts(steps: StepView[]): StepDraft[] {
  return steps.map((s) => ({
    key: s.id,
    id: s.id,
    type: s.type,
    waitDays: s.waitDays,
    waitMinutes: s.waitMinutes,
    enabled: s.enabled,
    threadMode: s.threadMode,
    subject: s.subject ?? "",
    body: s.body ?? "",
    variants: s.type === "auto_email" ? variantDrafts(s) : [],
  }));
}

function variantDrafts(s: StepView): VariantDraft[] {
  if (!s.variants.length) {
    return [{ key: `${s.id}-a`, label: "A", subject: s.subject ?? "", body: s.body ?? "", active: true }];
  }
  return s.variants.map((v) => ({
    key: v.id,
    id: v.id,
    label: v.label,
    subject: v.subject ?? "",
    body: v.body ?? "",
    active: v.active,
  }));
}

/** A new step of `type`, with sensible waits: right away for the first step, three days after otherwise. */
export function blankStep(type: StepType, isFirst: boolean): StepDraft {
  return {
    key: newKey("step"),
    type,
    waitDays: isFirst ? 0 : 3,
    waitMinutes: isFirst && type === "auto_email" ? 30 : 0,
    enabled: true,
    threadMode: isFirst ? "new_thread" : "reply",
    subject: "",
    body: "",
    variants: type === "auto_email" ? [{ key: newKey("v"), label: "A", subject: "", body: "", active: true }] : [],
  };
}

/** Change a step's type, carrying text across between email and task shapes. */
export function retype(step: StepDraft, type: StepType): StepDraft {
  if (type === step.type) return step;
  const a = step.variants[0];
  const subject = step.type === "auto_email" ? (a?.subject ?? "") : step.subject;
  const body = step.type === "auto_email" ? (a?.body ?? "") : step.body;
  return {
    ...step,
    type,
    subject,
    body,
    variants: type === "auto_email" ? [{ key: newKey("v"), label: "A", subject, body, active: true }] : [],
  };
}

export interface StepPayload {
  id?: string;
  type: StepType;
  waitDays: number;
  waitMinutes: number;
  enabled: boolean;
  threadMode: ThreadMode;
  subject: string | null;
  body: string | null;
  variants?: { id?: string; label: string; subject: string | null; body: string | null; active: boolean }[];
}

/** The PUT /steps body for the drafts. One version is sent as plain subject/body (and clears stored tests). */
export function serialise(drafts: StepDraft[]): StepPayload[] {
  return drafts.map((d) => {
    const base = {
      ...(d.id ? { id: d.id } : {}),
      type: d.type,
      waitDays: d.waitDays,
      waitMinutes: d.waitMinutes,
      enabled: d.enabled,
      threadMode: d.threadMode,
    };
    if (d.type === "auto_email") {
      if (d.variants.length > 1) {
        return {
          ...base,
          subject: d.variants[0].subject || null,
          body: d.variants[0].body || null,
          variants: d.variants.map((v) => ({
            ...(v.id ? { id: v.id } : {}),
            label: v.label,
            subject: v.subject || null,
            body: v.body || null,
            active: v.active,
          })),
        };
      }
      const a = d.variants[0];
      return { ...base, subject: a?.subject || null, body: a?.body || null, variants: [] };
    }
    return {
      ...base,
      subject: isEmailStep(d.type) ? d.subject || null : null,
      body: d.body || null,
    };
  });
}

/** Comparable form for change detection (keys and ids of unsaved rows don't matter). */
export const fingerprint = (drafts: StepDraft[]) => JSON.stringify(serialise(drafts));
