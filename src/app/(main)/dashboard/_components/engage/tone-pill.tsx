import { cn } from "cn";

import { Badge } from "@/components/ui/badge";

/** Status tones from BRANDING.md: tinted background, matching text, no dot. */
export const TONES = {
  positive: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  neutral: "bg-muted text-muted-foreground",
  attention: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  negative: "bg-destructive/10 text-destructive",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
} as const;

export type Tone = keyof typeof TONES;

export function TonePill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("font-medium", TONES[tone], className)}>
      {children}
    </Badge>
  );
}

const SEQUENCE: Record<string, [Tone, string]> = {
  draft: ["neutral", "Draft"],
  active: ["positive", "Active"],
  paused: ["attention", "Paused"],
  archived: ["neutral", "Archived"],
};

export function SequenceStatusPill({ status }: { status: string }) {
  const [tone, label] = SEQUENCE[status] ?? ["neutral", status];
  return <TonePill tone={tone}>{label}</TonePill>;
}

const ENROLLMENT: Record<string, [Tone, string]> = {
  active: ["positive", "Active"],
  paused: ["attention", "Paused"],
  finished: ["neutral", "Finished"],
  replied: ["info", "Replied"],
  bounced: ["negative", "Bounced"],
  unsubscribed: ["negative", "Unsubscribed"],
  removed: ["neutral", "Removed"],
};

export function EnrollmentStatusPill({ status }: { status: string }) {
  const [tone, label] = ENROLLMENT[status] ?? ["neutral", status];
  return <TonePill tone={tone}>{label}</TonePill>;
}

const MESSAGE: Record<string, [Tone, string]> = {
  pending_review: ["neutral", "Pending review"],
  queued: ["neutral", "Queued"],
  sent: ["positive", "Sent"],
  failed: ["negative", "Failed"],
  bounced: ["negative", "Bounced"],
  blocked: ["negative", "Blocked"],
};

export function MessageStatusPill({ status }: { status: string }) {
  const [tone, label] = MESSAGE[status] ?? ["neutral", status];
  return <TonePill tone={tone}>{label}</TonePill>;
}

const MAILBOX: Record<string, [Tone, string]> = {
  active: ["positive", "Active"],
  paused: ["attention", "Paused"],
  warming: ["attention", "Warming"],
  disconnected: ["negative", "Disconnected"],
};

export function MailboxStatusPill({ status }: { status: string }) {
  const [tone, label] = MAILBOX[status] ?? ["neutral", status];
  return <TonePill tone={tone}>{label}</TonePill>;
}
