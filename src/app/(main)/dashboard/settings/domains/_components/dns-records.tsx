import type { DnsRecord } from "@/server/services/domains";

import { CopyButton } from "./copy-button";

const PURPOSE: Record<DnsRecord["purpose"], string> = {
  routing: "Sends visitors to this installation.",
  ownership: "Proves you control the hostname. Keep it in place.",
};

/** The records to add at the DNS provider, each with copy buttons. */
export function DnsRecords({ records }: { records: DnsRecord[] }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="DNS records">
      {records.map((r) => (
        <li key={`${r.type}-${r.name}`} className="rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium font-mono text-xs">{r.type}</span>
            <span className="text-muted-foreground text-xs">{PURPOSE[r.purpose]}</span>
          </div>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:items-center">
            <dt className="text-muted-foreground text-xs">Name</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{r.name}</code>
              <CopyButton value={r.name} label={`${r.type} name`} />
            </dd>
            <dt className="text-muted-foreground text-xs">{r.type === "CNAME" ? "Points to" : "Value"}</dt>
            <dd className="flex min-w-0 items-center gap-1">
              <code className="min-w-0 flex-1 break-all font-mono text-xs">{r.value}</code>
              <CopyButton value={r.value} label={`${r.type} value`} />
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}
