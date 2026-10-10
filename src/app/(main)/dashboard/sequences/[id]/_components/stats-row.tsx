import type { DetailedStats } from "@/server/services/sequences";

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 sm:p-4">
      <span className="truncate text-muted-foreground text-xs">{label}</span>
      <span className="font-medium font-mono text-xl tabular-nums sm:text-2xl">{value.toLocaleString("en-US")}</span>
    </div>
  );
}

export function StatsRow({ stats }: { stats: DetailedStats }) {
  return (
    <section aria-label="Sequence numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 xl:grid-cols-6">
      <Kpi label="Enrolled" value={stats.enrolled} />
      <Kpi label="Active" value={stats.active} />
      <Kpi label="Sent" value={stats.sent} />
      <Kpi label="Replied" value={stats.replied} />
      <Kpi label="Finished" value={stats.finished} />
      <Kpi label="Bounced or unsubscribed" value={stats.bounced + stats.unsubscribed} />
    </section>
  );
}
