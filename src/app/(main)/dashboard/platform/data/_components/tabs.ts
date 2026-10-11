export const TABS = [
  { value: "overview", label: "Overview" },
  { value: "sources", label: "Seed sources" },
  { value: "queue", label: "Crawl queue" },
  { value: "hosts", label: "Hosts" },
  { value: "optouts", label: "Opt-outs" },
  { value: "settings", label: "Settings" },
] as const;

export type TabValue = (typeof TABS)[number]["value"];

export function isTab(value: string): value is TabValue {
  return TABS.some((t) => t.value === value);
}

export const numberFormat = new Intl.NumberFormat("en-US");

export function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const future = diff < 0;
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  let text: string;
  if (abs < 60_000) text = "less than a minute";
  else if (abs < 3_600_000) text = unit(Math.round(abs / 60_000), "minute");
  else if (abs < 86_400_000) text = unit(Math.round(abs / 3_600_000), "hour");
  else text = unit(Math.round(abs / 86_400_000), "day");
  return future ? `in ${text}` : `${text} ago`;
}

export function exactTime(iso: string | null): string | undefined {
  return iso ? new Date(iso).toLocaleString("en-US") : undefined;
}

export const PILL = {
  positive: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  neutral: "bg-muted text-muted-foreground",
  attention: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  negative: "bg-destructive/10 text-destructive",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
} as const;

export const STATUS_PILL: Record<string, keyof typeof PILL> = {
  queued: "neutral",
  fetching: "info",
  done: "positive",
  failed: "negative",
  skipped: "attention",
};

export const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  fetching: "Fetching",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
};

export const KIND_LABEL: Record<string, string> = {
  homepage: "Homepage",
  about: "About",
  team: "Team",
  contact: "Contact",
  careers: "Careers",
  sitemap: "Sitemap",
  rss: "Feed",
  ats: "Job board",
  other: "Other",
};
