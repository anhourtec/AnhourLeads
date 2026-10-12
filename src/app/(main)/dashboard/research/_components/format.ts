/** Small display helpers for the research screens. */

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "—";
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  return relative.format(Math.round(seconds / 86_400), "day");
}

export function exactTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "";
}

export function duration(startIso: string | null, endIso: string | null): string | null {
  if (!startIso || !endIso) return null;
  const seconds = Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Path and query of a URL for compact display. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** Read `{ error }` from a failed API response. */
export async function apiError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; details?: Array<{ message?: string }> };
    return body.details?.[0]?.message ?? body.error ?? fallback;
  } catch {
    return fallback;
  }
}
