import { cn } from "cn";

import { Badge } from "@/components/ui/badge";

const TONES = {
  positive: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  neutral: "bg-muted text-muted-foreground",
  attention: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  negative: "bg-destructive/10 text-destructive",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
} as const;
type Tone = keyof typeof TONES;

export function Pill({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("font-medium", TONES[tone], className)}>
      {children}
    </Badge>
  );
}

const CRAWL: Record<string, [Tone, string]> = {
  queued: ["neutral", "Queued"],
  running: ["info", "Running"],
  completed: ["positive", "Completed"],
  failed: ["negative", "Failed"],
};

export function CrawlStatusPill({ status }: { status: string }) {
  const [tone, label] = CRAWL[status] ?? ["neutral", status];
  return <Pill tone={tone}>{label}</Pill>;
}

const EMAIL: Record<string, [Tone, string]> = {
  valid: ["positive", "Valid"],
  unverified: ["neutral", "Unverified"],
  unknown: ["neutral", "Unknown"],
  catch_all: ["attention", "Catch-all"],
  role: ["attention", "Role address"],
  invalid: ["negative", "Invalid"],
  disposable: ["negative", "Disposable"],
};

export function EmailStatusPill({ status }: { status: string | undefined }) {
  const [tone, label] = EMAIL[status ?? "unverified"] ?? ["neutral", status ?? "Unverified"];
  return <Pill tone={tone}>{label}</Pill>;
}

export const SKIP_LABELS: Record<string, string> = {
  robots: "Blocked by robots.txt",
  offsite: "Other website",
  too_large: "Larger than 1 MB",
  not_html: "Not a web page",
  blocked_host: "Private address",
  timeout: "Timed out",
  too_many_redirects: "Too many redirects",
  http_error: "Error response",
  network: "Network error",
  dns: "Domain not found",
  duplicate: "Duplicate",
};

export function SkipPill({ reason }: { reason: string }) {
  return <Pill tone={reason === "robots" ? "attention" : "neutral"}>{SKIP_LABELS[reason] ?? reason}</Pill>;
}
