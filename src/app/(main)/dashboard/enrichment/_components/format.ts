const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 days ago" for recent events. */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "never";
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return rtf.format(seconds, "second");
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), "hour");
  return rtf.format(Math.round(seconds / 86_400), "day");
}

export function exactTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "";
}

export const num = (n: number) => n.toLocaleString("en-US");

export function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}
