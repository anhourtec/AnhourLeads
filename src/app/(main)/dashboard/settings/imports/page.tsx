import Link from "next/link";
import { notFound } from "next/navigation";

import { FileDown, FileUp, Upload } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { pageFrom, pagination } from "@/server/http/route";
import { type HistoryEntry, importHistory } from "@/server/services/imports";

import { PageHeader } from "../../_components/records/page-header";
import { RecordsPagination } from "../../_components/records/records-pagination";

export const metadata: Metadata = { title: "Imports and exports" };

const KIND: Record<HistoryEntry["action"], { label: string; what: string; icon: "in" | "out" }> = {
  "contact.import": { label: "Import", what: "People", icon: "in" },
  "company.import": { label: "Import", what: "Companies", icon: "in" },
  "contact.export": { label: "Export", what: "People", icon: "out" },
  "company.export": { label: "Export", what: "Companies", icon: "out" },
};

const HEAD = "px-4 font-mono text-[11px] font-normal text-muted-foreground uppercase tracking-wider";

function n(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

export default async function ImportsHistoryPage({ searchParams }: PageProps<"/dashboard/settings/imports">) {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor) notFound();
  const sp = await searchParams;
  const page = pageFrom({ page: typeof sp.page === "string" ? sp.page : 1, per_page: 25 });
  const { entries, total } = await importHistory(actor, page);
  const canImport = can(actor.role, "contact:import") || can(actor.role, "company:import");

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Imports and exports"
        description="Every CSV file brought into or taken out of this workspace, by whom and with what result."
        actions={
          canImport ? (
            <Button asChild size="sm">
              <Link href="/dashboard/import">
                <Upload data-icon="inline-start" aria-hidden="true" />
                Import CSV
              </Link>
            </Button>
          ) : null
        }
      />
      <Card className="min-w-0 gap-4 py-4">
        <CardContent className="px-0">
          {entries.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className={HEAD}>When</TableHead>
                    <TableHead className={HEAD}>Type</TableHead>
                    <TableHead className={HEAD}>File</TableHead>
                    <TableHead className={HEAD}>By</TableHead>
                    <TableHead className={`${HEAD} text-right`}>Rows</TableHead>
                    <TableHead className={`${HEAD} text-right`}>Created</TableHead>
                    <TableHead className={`${HEAD} text-right`}>Updated</TableHead>
                    <TableHead className={`${HEAD} text-right`}>Skipped</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e) => {
                    const kind = KIND[e.action];
                    const isImport = kind.icon === "in";
                    return (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap px-4">
                          <time dateTime={e.createdAt} title={new Date(e.createdAt).toUTCString()}>
                            {new Date(e.createdAt).toLocaleString("en-US", {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: "UTC",
                            })}{" "}
                            UTC
                          </time>
                        </TableCell>
                        <TableCell className="px-4">
                          <Badge variant="outline" className="gap-1 font-medium">
                            {isImport ? <FileUp aria-hidden="true" /> : <FileDown aria-hidden="true" />}
                            {kind.label} · {kind.what}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-56 truncate px-4 font-mono text-xs">
                          {e.fileName ?? <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap px-4">
                          {e.actorName ?? (e.viaApiKey ? "API key" : "—")}
                        </TableCell>
                        <TableCell className="px-4 text-right font-mono tabular-nums">
                          {n(isImport ? e.total : e.count)}
                        </TableCell>
                        <TableCell className="px-4 text-right font-mono tabular-nums">{n(e.created)}</TableCell>
                        <TableCell className="px-4 text-right font-mono tabular-nums">{n(e.updated)}</TableCell>
                        <TableCell className="px-4 text-right font-mono tabular-nums">{n(e.skipped)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty className="mx-4 border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileUp aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No imports or exports yet</EmptyTitle>
                <EmptyDescription>CSV files you import or export appear here with their results.</EmptyDescription>
              </EmptyHeader>
              {canImport ? (
                <EmptyContent>
                  <Button asChild size="sm">
                    <Link href="/dashboard/import">
                      <Upload data-icon="inline-start" aria-hidden="true" />
                      Import CSV
                    </Link>
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          )}
        </CardContent>
        {total > 0 ? <RecordsPagination pagination={pagination(page, total)} noun="entries" /> : null}
      </Card>
    </div>
  );
}
