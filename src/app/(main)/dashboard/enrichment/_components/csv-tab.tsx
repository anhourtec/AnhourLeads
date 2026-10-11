"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Download, FileUp, Sparkles } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api-fetch";
import type { CsvResultRow, EnrichmentJobView } from "@/server/services/enrichment-jobs";

import { exactTime, num, timeAgo } from "./format";
import { EmailStatusPill, JobStatusPill, sourceLabel } from "./pills";
import type { EnrichmentPermissions } from "./types";

const MAX_ROWS = 10_000;
const POLL_MS = 2000;
const KNOWN = [
  "firstname",
  "lastname",
  "name",
  "fullname",
  "company",
  "companyname",
  "domain",
  "website",
  "url",
  "email",
  "emailaddress",
];

interface Selected {
  name: string;
  text: string;
  rows: number;
  columns: string[];
}

interface Detail {
  enrichment_job: EnrichmentJobView;
  rows: CsvResultRow[];
  rows_total: number;
}

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function describe(text: string): { rows: number; columns: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header = (lines[0] ?? "").split(/[,;\t]/).map((h) => h.replace(/^"|"$/g, "").trim());
  return { rows: Math.max(0, lines.length - 1), columns: header.filter((h) => KNOWN.includes(key(h))) };
}

export function CsvTab({
  initialJobs,
  permissions,
}: {
  initialJobs: EnrichmentJobView[];
  permissions: EnrichmentPermissions;
}) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState(initialJobs);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [save, setSave] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const job = detail?.enrichment_job;
  const active = job?.status === "queued" || job?.status === "running";

  const load = useCallback(async (id: string) => {
    const res = await apiFetch<Detail>(`/api/v1/enrichment_jobs/${id}`);
    if (res.ok) {
      setDetail(res.data);
      setJobs((current) => current.map((j) => (j.id === id ? res.data.enrichment_job : j)));
    } else setError(res.error);
  }, []);

  useEffect(() => {
    if (!active || !job) return;
    const timer = setInterval(() => void load(job.id), POLL_MS);
    return () => clearInterval(timer);
  }, [active, job, load]);

  const pick = async (file: File | null) => {
    setError(null);
    if (!file) {
      setSelected(null);
      return;
    }
    const text = await file.text();
    const info = describe(text);
    if (info.rows > MAX_ROWS) {
      setSelected(null);
      setError(`The file has ${num(info.rows)} rows. Enrich up to 10,000 at a time.`);
      return;
    }
    setSelected({ name: file.name, text, ...info });
  };

  const start = async () => {
    if (!selected) {
      setError("Choose a CSV file first.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await apiFetch<{ enrichment_job: EnrichmentJobView }>("/api/v1/enrichment_jobs", {
      body: { kind: "csv", fileName: selected.name, csv: selected.text, saveToRecords: save },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const created = res.data.enrichment_job;
    setJobs((current) => [created, ...current]);
    setDetail({ enrichment_job: created, rows: [], rows_total: 0 });
    setSelected(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 md:gap-6">
      {permissions.enrich ? (
        <Card>
          <CardHeader>
            <CardTitle>Enrich a CSV</CardTitle>
            <CardDescription className="max-w-prose">
              Upload up to 10,000 people with a name and a company domain or website, or an email to verify. Each row
              gets an email, its status, where it came from and how certain it is.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={inputId}>CSV file</Label>
              <input
                ref={fileRef}
                id={inputId}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void pick(e.target.files?.item(0) ?? null)}
                className="block w-full max-w-md cursor-pointer rounded-md border bg-background text-sm file:mr-3 file:cursor-pointer file:border-0 file:border-r file:bg-muted file:px-3 file:py-1.5 file:font-medium file:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-muted-foreground text-xs">
                Columns: <span className="font-mono">first_name, last_name</span> or{" "}
                <span className="font-mono">name</span>, plus{" "}
                <span className="font-mono">company, domain, website, email</span>. Header names aren't case-sensitive.
              </p>
            </div>
            {selected ? (
              <p className="text-sm">
                <span className="font-medium">{selected.name}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {num(selected.rows)} rows ·{" "}
                  {selected.columns.length ? `recognised: ${selected.columns.join(", ")}` : "no known columns"}
                </span>
              </p>
            ) : null}
            {permissions.createContacts ? (
              <div className="flex items-start gap-2">
                <Checkbox id="csv-save" checked={save} onCheckedChange={(v) => setSave(v === true)} />
                <Label htmlFor="csv-save" className="flex flex-col items-start gap-0.5">
                  <span>Also save to my records</span>
                  <span className="font-normal text-muted-foreground text-xs">
                    Adds people with a found address as contacts, with the source of each value. Existing people are
                    left as they are.
                  </span>
                </Label>
              </div>
            ) : null}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter>
            <Button size="sm" onClick={start} disabled={pending}>
              <FileUp data-icon="inline-start" aria-hidden="true" />
              {pending ? "Uploading…" : "Enrich CSV"}
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <p className="text-muted-foreground text-sm">
          You can see past CSV enrichments. Your role can't start new ones.
        </p>
      )}

      {job ? (
        <Card className="min-w-0">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="flex flex-wrap items-center gap-2">
                <span className="truncate">{job.label}</span>
                <JobStatusPill status={job.status} />
              </CardTitle>
              <CardDescription>
                <span className="font-mono tabular-nums">
                  {num(job.processed)} of {num(job.total)}
                </span>{" "}
                rows checked · {num(job.enriched)} with an address
              </CardDescription>
            </div>
            {job.status === "completed" ? (
              <Button asChild size="sm" variant="outline">
                <a href={`/api/v1/enrichment_jobs/${job.id}/download`} download>
                  <Download data-icon="inline-start" aria-hidden="true" />
                  Download enriched CSV
                </a>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-3">
            {active ? (
              <Progress value={job.total ? (job.processed / job.total) * 100 : 0} aria-label="Enrichment progress" />
            ) : null}
            {detail.rows.length ? (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Row</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.rows.map((r) => (
                      <TableRow key={r.row}>
                        <TableCell className="font-mono text-muted-foreground text-xs tabular-nums">{r.row}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {[r.firstName, r.lastName].filter(Boolean).join(" ") || "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex flex-col">
                            <span>{r.company ?? "—"}</span>
                            {r.domain ? (
                              <span className="font-mono text-muted-foreground text-xs">{r.domain}</span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.email ? (
                            <span className="font-mono text-xs">{r.email}</span>
                          ) : (
                            <span className="text-muted-foreground text-xs">{r.note ?? "Not found"}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <EmailStatusPill status={r.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {r.sourceUrl ? (
                            <a href={r.sourceUrl} target="_blank" rel="noreferrer noopener" className="hover:underline">
                              {sourceLabel(r.source)}
                            </a>
                          ) : (
                            sourceLabel(r.source)
                          )}
                          {r.saved === "created" ? <span className="text-muted-foreground"> · saved</span> : null}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {r.confidence === null ? "—" : `${Math.round(r.confidence * 100)}%`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">{active ? "Checking rows…" : "No rows yet."}</p>
            )}
            {detail.rows_total > detail.rows.length ? (
              <p className="text-muted-foreground text-xs">
                Showing the first {num(detail.rows.length)} of {num(detail.rows_total)} rows. Download the CSV for all
                of them.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recent CSV enrichments</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No CSV enrichments yet</EmptyTitle>
                <EmptyDescription>Upload a file above and the results show up here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {jobs.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div className="flex min-w-0 flex-col">
                    <button
                      type="button"
                      className="truncate text-left font-medium hover:underline focus-visible:underline focus-visible:outline-none"
                      onClick={() => void load(j.id)}
                    >
                      {j.label}
                    </button>
                    <span className="text-muted-foreground text-xs">
                      <span className="font-mono tabular-nums">{num(j.total)}</span> {j.total === 1 ? "row" : "rows"} ·{" "}
                      <span className="font-mono tabular-nums">{num(j.enriched)}</span> found ·{" "}
                      <time dateTime={j.createdAt} title={exactTime(j.createdAt)} suppressHydrationWarning>
                        {timeAgo(j.createdAt)}
                      </time>
                    </span>
                  </div>
                  <JobStatusPill status={j.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <Sparkles className="size-3.5" aria-hidden="true" />
        Addresses come from the company's public website or its email format, then are checked without sending mail.
      </p>
    </div>
  );
}
