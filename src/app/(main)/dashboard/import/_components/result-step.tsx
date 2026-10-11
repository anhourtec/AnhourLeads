"use client";

import Link from "next/link";

import { CircleCheck, Download, FileUp, ListChecks, Users } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { ENTITY_COPY, type ImportEntityKey, type ImportReport } from "./types";

function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadErrors(report: ImportReport, fileName: string) {
  const body = [["row", "error"], ...report.errors.map((e) => [e.row, e.message])]
    .map((r) => r.map(csvCell).join(","))
    .join("\r\n");
  const url = URL.createObjectURL(new Blob([`${body}\r\n`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName.replace(/\.[^.]+$/, "")}-errors.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Step 3: what the import did, with the rows that were skipped and why. */
export function ResultStep({
  type,
  fileName,
  report,
  onAgain,
}: {
  type: ImportEntityKey;
  fileName: string;
  report: ImportReport;
  onAgain: () => void;
}) {
  const copy = ENTITY_COPY[type];
  const stats = [
    { label: "Created", value: report.created },
    { label: "Updated", value: report.updated },
    { label: "Skipped", value: report.skipped },
    ...(report.companiesCreated !== undefined ? [{ label: "Accounts created", value: report.companiesCreated }] : []),
  ];
  const browse = type === "contacts" ? "/dashboard/people" : "/dashboard/companies";

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="font-medium text-2xl tracking-tight">{copy.title}</h1>
        <p className="truncate font-mono text-muted-foreground text-xs">{fileName}</p>
      </div>
      <Alert>
        <CircleCheck aria-hidden="true" />
        <AlertTitle>Import finished</AlertTitle>
        <AlertDescription>
          {report.total.toLocaleString("en-US")} {report.total === 1 ? "row" : "rows"} read.
          {report.enrichmentQueued
            ? ` Enrichment is running for ${report.enrichmentQueued.toLocaleString("en-US")} ${report.enrichmentQueued === 1 ? "person" : "people"}.`
            : ""}
        </AlertDescription>
      </Alert>
      <section aria-label="Import summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="gap-1 py-4">
            <CardHeader className="px-4">
              <CardDescription>{s.label}</CardDescription>
            </CardHeader>
            <CardContent className="px-4">
              <p
                className="font-medium font-mono text-2xl tabular-nums"
                data-testid={`import-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                {s.value.toLocaleString("en-US")}
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href={browse}>
            <Users data-icon="inline-start" aria-hidden="true" />
            View {copy.noun}
          </Link>
        </Button>
        {report.listId ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/lists/${report.listId}`}>
              <ListChecks data-icon="inline-start" aria-hidden="true" />
              Open {report.listName ?? "the list"}
            </Link>
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onAgain}>
          <FileUp data-icon="inline-start" aria-hidden="true" />
          Import another file
        </Button>
      </div>
      {report.errors.length ? (
        <Card className="gap-4">
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <CardTitle className="font-medium text-base">
                <h2>Rows that weren't imported</h2>
              </CardTitle>
              <CardDescription>
                Fix them in your file and import it again; imported rows are matched, not duplicated.
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => downloadErrors(report, fileName)}>
              <Download data-icon="inline-start" aria-hidden="true" />
              Download errors
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24 px-4 font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
                    Row
                  </TableHead>
                  <TableHead className="px-4 font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
                    Reason
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.errors.slice(0, 100).map((e) => (
                  <TableRow key={`${e.row}-${e.message}`}>
                    <TableCell className="px-4 font-mono tabular-nums">{e.row}</TableCell>
                    <TableCell className="whitespace-normal px-4">{e.message}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {report.errors.length > 100 ? (
              <p className="px-4 pt-3 text-muted-foreground text-xs">
                Showing the first 100. Download the file for all {report.errors.length.toLocaleString("en-US")}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
