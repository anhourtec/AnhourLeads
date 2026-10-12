import { formatDistanceToNowStrict } from "date-fns";

export interface ProvenanceEntry {
  field: string;
  source: string;
  sourceUrl: string | null;
  confidence: number;
  retrievedAt: string;
}

/** Latest provenance row per field (rows arrive newest first). */
export function latestByField(rows: ProvenanceEntry[]): Map<string, ProvenanceEntry> {
  const map = new Map<string, ProvenanceEntry>();
  for (const row of rows) if (!map.has(row.field)) map.set(row.field, row);
  return map;
}

/** "csv_import · 3 days ago · 90%", rendered on the server. */
export function ProvenanceLine({ entry }: { entry?: ProvenanceEntry }) {
  if (!entry) return null;
  const at = new Date(entry.retrievedAt);
  const exact = `${at.toISOString().replace("T", " ").slice(0, 16)} UTC`;
  return (
    <p className="text-muted-foreground text-xs" data-testid="provenance">
      {entry.sourceUrl ? (
        <a
          href={entry.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="underline-offset-4 hover:underline"
        >
          {entry.source}
        </a>
      ) : (
        entry.source
      )}{" "}
      ·{" "}
      <time dateTime={entry.retrievedAt} title={exact}>
        {formatDistanceToNowStrict(at, { addSuffix: true })}
      </time>
      {entry.confidence < 1 ? <> · {Math.round(entry.confidence * 100)}%</> : null}
    </p>
  );
}

/** One labelled value in a detail card, with where it came from underneath. */
export function DetailField({
  label,
  children,
  provenance,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  provenance?: ProvenanceEntry;
  mono?: boolean;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={mono ? "break-all font-mono text-sm" : "break-words text-sm"}>
        {empty ? <span className="text-muted-foreground">Not set</span> : children}
      </dd>
      {empty ? null : <ProvenanceLine entry={provenance} />}
    </div>
  );
}
