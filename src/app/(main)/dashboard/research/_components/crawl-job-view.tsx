"use client";

import { useEffect } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowLeft, Building2, Globe, Mail, Users, Wrench } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CrawlFindings, Fact } from "@/server/crawler/types";
import type { CrawlJobDetail } from "@/server/services/research";

import { ApplyFindingsDialog } from "./apply-findings-dialog";
import { duration, shortUrl } from "./format";
import { RelativeTime } from "./relative-time";
import { CrawlStatusPill, EmailStatusPill, SkipPill } from "./status-pill";

const ACTIVE = new Set(["queued", "running"]);

const FACT_LABELS: Partial<Record<Fact["field"], string>> = {
  name: "Legal name",
  siteName: "Site name",
  description: "Description",
  phone: "Phone",
  foundedYear: "Founded",
  copyrightYear: "Copyright since",
  employeeCount: "Employees",
  city: "City",
  country: "Country",
};
const METHOD_LABELS: Record<string, string> = {
  obfuscated: "written out",
  mailto: "email link",
  text: "page text",
  cloudflare: "protected link",
  json_ld: "structured data",
};

function robotsSummary(robots: NonNullable<CrawlFindings["robots"]>): string {
  if (robots.status === "missing") return "not found, all pages allowed";
  if (robots.status === "unreachable") return "unreachable, nothing fetched";
  const rules = `${robots.disallowRules} ${robots.disallowRules === 1 ? "rule" : "rules"}`;
  const delay = robots.crawlDelaySeconds !== null ? `, ${robots.crawlDelaySeconds}s delay` : "";
  return `respected (${rules}${delay})`;
}

const MONO_FACTS = new Set(["phone", "foundedYear", "copyrightYear", "employeeCount"]);

/** Refresh the server-rendered job while it is queued or running. */
function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}

function EmptyFinding({ icon: Icon, text }: { icon: typeof Mail; text: string }) {
  return (
    <Empty className="p-4">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function SourceLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="break-all font-mono text-muted-foreground text-xs underline-offset-4 hover:underline"
    >
      {shortUrl(url)}
    </a>
  );
}

function CompanyFacts({ findings }: { findings: CrawlFindings }) {
  const rows = Object.keys(FACT_LABELS).flatMap((field) => {
    const fact = findings.facts.filter((f) => f.field === field).sort((a, b) => b.confidence - a.confidence)[0];
    return fact ? [fact] : [];
  });
  const hiring = findings.hiring;
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Company facts</CardTitle>
        <CardDescription>Each value shows the page it came from and how confident the match is.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 && !hiring.careersUrl ? (
          <EmptyFinding icon={Building2} text="No company facts were found on the crawled pages." />
        ) : (
          <dl className="flex flex-col divide-y">
            {rows.map((fact) => (
              <div key={fact.field} className="flex flex-col gap-1 py-2 first:pt-0 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-muted-foreground text-sm sm:w-32">{FACT_LABELS[fact.field]}</dt>
                <dd className="flex min-w-0 flex-col gap-0.5">
                  <span className={MONO_FACTS.has(fact.field) ? "font-mono text-sm" : "text-sm"}>{fact.value}</span>
                  <span className="flex flex-wrap items-center gap-x-1 text-muted-foreground text-xs">
                    <SourceLink url={fact.sourceUrl} />
                    <span>· {Math.round(fact.confidence * 100)}%</span>
                  </span>
                </dd>
              </div>
            ))}
            {hiring.careersUrl || hiring.ats.length || hiring.mentions.length ? (
              <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-muted-foreground text-sm sm:w-32">Hiring</dt>
                <dd className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <span>
                    {hiring.jobCount !== null ? (
                      <>
                        <span className="font-mono tabular-nums">{hiring.jobCount}</span> open{" "}
                        {hiring.jobCount === 1 ? "role" : "roles"}
                      </>
                    ) : (
                      "Hiring signals found"
                    )}
                    {hiring.ats.length ? ` · ${hiring.ats.join(", ")}` : null}
                  </span>
                  {hiring.careersUrl ? <SourceLink url={hiring.careersUrl} /> : null}
                </dd>
              </div>
            ) : null}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function Emails({ findings }: { findings: CrawlFindings }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Emails</CardTitle>
        <CardDescription>
          {findings.suppressedEmails
            ? `${findings.suppressedEmails} on your do-not-contact list ${findings.suppressedEmails === 1 ? "was" : "were"} left out.`
            : "Checked against DNS and disposable domains."}
          {findings.emailPattern ? (
            <>
              {" "}
              Pattern <span className="font-mono">{findings.emailPattern.pattern}</span>.
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {findings.emails.length === 0 ? (
          <EmptyFinding icon={Mail} text="No email addresses were found." />
        ) : (
          <ul className="flex flex-col divide-y">
            {findings.emails.map((e) => (
              <li key={e.email} className="flex flex-col gap-1 py-2 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 break-all font-mono text-sm">{e.email}</span>
                  <EmailStatusPill status={e.status} />
                </div>
                <span className="flex flex-wrap gap-x-1 text-muted-foreground text-xs">
                  <SourceLink url={e.sourceUrl} />
                  <span>· {METHOD_LABELS[e.method] ?? e.method}</span>
                  {e.person ? <span>· {e.person}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function People({ findings }: { findings: CrawlFindings }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>People</CardTitle>
        <CardDescription>From team and leadership pages.</CardDescription>
      </CardHeader>
      <CardContent>
        {findings.people.length === 0 ? (
          <EmptyFinding icon={Users} text="No people were found." />
        ) : (
          <ul className="flex flex-col divide-y">
            {findings.people.map((p) => (
              <li key={p.name} className="flex flex-col gap-0.5 py-2 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="font-medium text-sm">{p.name}</span>
                  <span className="text-muted-foreground text-xs">{Math.round(p.confidence * 100)}%</span>
                </div>
                {p.title ? <span className="text-sm">{p.title}</span> : null}
                <span className="flex flex-wrap gap-x-1 text-muted-foreground text-xs">
                  <SourceLink url={p.sourceUrl} />
                  {p.email ? <span className="font-mono">· {p.email}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TechAndSocial({ findings }: { findings: CrawlFindings }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Technologies and profiles</CardTitle>
        <CardDescription>Detected from page markup and response headers.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {findings.technologies.length === 0 ? (
          <EmptyFinding icon={Wrench} text="No technologies were detected." />
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Technologies">
            {findings.technologies.map((t) => (
              <li key={t.name} className="rounded-md border px-2 py-1 text-xs" title={`${t.category} · ${t.evidence}`}>
                {t.name}
                <span className="text-muted-foreground"> · {t.category}</span>
              </li>
            ))}
          </ul>
        )}
        {findings.social.length ? (
          <ul className="flex flex-col gap-1" aria-label="Social profiles">
            {findings.social.map((s) => (
              <li key={s.url} className="flex min-w-0 items-center gap-2 text-sm">
                <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="min-w-0 truncate font-mono text-xs underline-offset-4 hover:underline"
                >
                  {s.url.replace(/^https:\/\/(www\.)?/, "")}
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Pages({ detail }: { detail: CrawlJobDetail }) {
  const robots = detail.findings?.robots ?? null;
  const skipped = detail.pages.filter((p) => p.skippedReason).length;
  return (
    <Card className="min-w-0 gap-0 pb-0">
      <CardHeader className="pb-4">
        <CardTitle>Pages</CardTitle>
        <CardDescription>
          <span className="font-mono tabular-nums">{detail.pages.length - skipped}</span> fetched ·{" "}
          <span className="font-mono tabular-nums">{skipped}</span> skipped
          {robots ? (
            <>
              {" · robots.txt "}
              {robotsSummary(robots)}
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {detail.pages.length === 0 ? (
          <div className="border-t p-6 text-muted-foreground text-sm">No pages yet.</div>
        ) : (
          <div className="overflow-x-auto border-t">
            <Table className="min-w-[640px]">
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6">URL</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                  <TableHead className="pr-6">Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.pages.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="max-w-80 truncate pl-6 font-mono text-xs" title={p.url}>
                      {shortUrl(p.url)}
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">{p.title ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">{p.statusCode ?? "—"}</TableCell>
                    <TableCell className="pr-6">
                      {p.skippedReason ? (
                        <SkipPill reason={p.skippedReason} />
                      ) : (
                        <span className="text-muted-foreground text-xs">Fetched</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CrawlJobView({
  detail,
  canApply,
  canCreateContacts,
}: {
  detail: CrawlJobDetail;
  canApply: boolean;
  canCreateContacts: boolean;
}) {
  const { job, findings } = detail;
  const active = ACTIVE.has(job.status);
  const took = duration(job.startedAt, job.finishedAt);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <AutoRefresh active={active} />
      <div className="flex flex-col gap-3">
        <Link
          href="/dashboard/research"
          className="inline-flex w-fit items-center gap-1 rounded-sm text-muted-foreground text-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Research
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-all font-medium font-mono text-2xl tracking-tight">
                {job.domain ?? shortUrl(job.seedUrl)}
              </h1>
              <CrawlStatusPill status={job.status} />
            </div>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm">
              <span className="break-all font-mono text-xs">{job.seedUrl}</span>
              {job.companyName ? <span>{job.companyName}</span> : null}
              <span>
                <span className="font-mono tabular-nums">{job.pagesCrawled}</span> of{" "}
                <span className="font-mono tabular-nums">{job.maxPages}</span> pages
              </span>
              <span>
                Started <RelativeTime iso={job.startedAt ?? job.createdAt} />
              </span>
              {took ? <span>Took {took}</span> : null}
            </p>
          </div>
          {canApply && job.status === "completed" && findings ? (
            <ApplyFindingsDialog
              jobId={job.id}
              companyName={job.companyName}
              domain={job.domain}
              peopleCount={findings.people.length}
              canCreateContacts={canCreateContacts}
            />
          ) : null}
        </div>
      </div>

      {active ? (
        <Alert>
          <Spinner aria-hidden="true" />
          <AlertTitle>{job.status === "queued" ? "Waiting to start" : "Crawling"}</AlertTitle>
          <AlertDescription>This page updates on its own. Pages appear below as they are fetched.</AlertDescription>
        </Alert>
      ) : null}
      {job.status === "failed" ? (
        <Alert variant="destructive">
          <AlertTitle>The crawl didn't finish</AlertTitle>
          <AlertDescription>{job.error ?? "No pages could be fetched."}</AlertDescription>
        </Alert>
      ) : null}

      {findings ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <CompanyFacts findings={findings} />
          <Emails findings={findings} />
          <People findings={findings} />
          <TechAndSocial findings={findings} />
        </div>
      ) : null}

      <Pages detail={detail} />
    </div>
  );
}
