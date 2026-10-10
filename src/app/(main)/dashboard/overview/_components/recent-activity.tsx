import Link from "next/link";

import { ArrowRight, History } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { formatDateTime, relativeTime } from "@/lib/format-display";
import type { AuditLogDto } from "@/server/services/audit-log";

import { actorLabel, describeAction } from "../../_components/pipeline/audit-describe";

export function RecentActivity({ entries, now }: { readonly entries: AuditLogDto[]; readonly now: string }) {
  const reference = new Date(now);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/settings/audit-log">
              <ArrowRight data-icon="inline-start" />
              Audit log
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No activity yet</EmptyTitle>
              <EmptyDescription>Changes people make in this workspace are listed here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{actorLabel(entry)}</span>{" "}
                  <span className="text-muted-foreground">{describeAction(entry.action)}</span>
                </span>
                <time
                  dateTime={entry.createdAt}
                  title={formatDateTime(entry.createdAt)}
                  className="shrink-0 text-muted-foreground text-xs"
                >
                  {relativeTime(entry.createdAt, reference)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
