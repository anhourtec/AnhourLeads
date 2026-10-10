"use client";

import { exactTime, timeAgo } from "./format";

/** Relative time with the exact time as a tooltip. Differs between server and browser, so hydration is relaxed. */
export function RelativeTime({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">—</span>;
  return (
    <time dateTime={iso} title={exactTime(iso)} suppressHydrationWarning>
      {timeAgo(iso)}
    </time>
  );
}
