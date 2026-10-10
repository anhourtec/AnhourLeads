import { cn } from "cn";

import { Badge } from "@/components/ui/badge";
import {
  COMPANY_STAGE_LABELS,
  CONTACT_STAGE_LABELS,
  type CompanyStage,
  type ContactEmailStatus,
  type ContactStage,
  EMAIL_STATUS_LABELS,
} from "@/lib/records-vocabulary";

const TONES = {
  positive: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  neutral: "bg-muted text-muted-foreground",
  attention: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  negative: "bg-destructive/10 text-destructive",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
} as const;
type Tone = keyof typeof TONES;

function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("font-medium", TONES[tone], className)}>
      {children}
    </Badge>
  );
}

const EMAIL_TONES: Record<ContactEmailStatus, Tone> = {
  valid: "positive",
  unverified: "neutral",
  unknown: "neutral",
  catch_all: "attention",
  role: "attention",
  invalid: "negative",
  disposable: "negative",
};

export function EmailStatusPill({ status }: { status: ContactEmailStatus }) {
  return <Pill tone={EMAIL_TONES[status]}>{EMAIL_STATUS_LABELS[status]}</Pill>;
}

const CONTACT_STAGE_TONES: Record<ContactStage, Tone> = {
  new: "info",
  contacted: "neutral",
  replied: "info",
  interested: "positive",
  not_interested: "neutral",
  unresponsive: "attention",
  do_not_contact: "negative",
};

export function ContactStagePill({ stage }: { stage: ContactStage }) {
  return <Pill tone={CONTACT_STAGE_TONES[stage]}>{CONTACT_STAGE_LABELS[stage]}</Pill>;
}

const COMPANY_STAGE_TONES: Record<CompanyStage, Tone> = {
  cold: "neutral",
  prospect: "info",
  engaged: "attention",
  customer: "positive",
  churned: "negative",
};

export function CompanyStagePill({ stage }: { stage: CompanyStage }) {
  return <Pill tone={COMPANY_STAGE_TONES[stage]}>{COMPANY_STAGE_LABELS[stage]}</Pill>;
}

export function SuppressedPill() {
  return <Pill tone="negative">Suppressed</Pill>;
}
