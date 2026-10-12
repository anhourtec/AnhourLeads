"use client";

import { useCallback, useEffect, useState } from "react";

import { ShieldCheck } from "lucide-react";

import type { CrawlJobView } from "@/server/services/research";

import { CrawlJobsTable } from "./crawl-jobs-table";
import { NewCrawlCard } from "./new-crawl-card";
import { VerifyEmailCard } from "./verify-email-card";

export interface CompanyOption {
  id: string;
  name: string;
  domain: string | null;
}

const ACTIVE = new Set(["queued", "running"]);
const POLL_MS = 3000;

export function ResearchWorkspace({
  initialJobs,
  total,
  companies,
  canRun,
  canVerify,
}: {
  initialJobs: CrawlJobView[];
  total: number;
  companies: CompanyOption[];
  canRun: boolean;
  canVerify: boolean;
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [count, setCount] = useState(total);
  const [refreshError, setRefreshError] = useState(false);
  const active = jobs.some((j) => ACTIVE.has(j.status));

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/crawl_jobs?per_page=25", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { crawl_jobs: CrawlJobView[]; pagination: { total_entries: number } };
      setJobs(body.crawl_jobs);
      setCount(body.pagination.total_entries);
      setRefreshError(false);
    } catch {
      setRefreshError(true);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  const onCreated = (job: CrawlJobView) => {
    setJobs((current) => [job, ...current.filter((j) => j.id !== job.id)]);
    setCount((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-medium text-2xl tracking-tight">Research</h1>
        <p className="max-w-prose text-muted-foreground text-sm">
          Crawl a company's public website for contact details, people, technologies and hiring signals. Only public
          pages are fetched, robots.txt is respected and nothing behind a login is touched.
        </p>
      </div>

      {canRun || canVerify ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          {canRun ? <NewCrawlCard companies={companies} onCreated={onCreated} className="lg:col-span-2" /> : null}
          {canVerify ? <VerifyEmailCard className={canRun ? undefined : "lg:col-span-3"} /> : null}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <ShieldCheck className="size-4" aria-hidden="true" />
          You can view crawl results. Ask a member or manager to start new crawls.
        </p>
      )}

      <CrawlJobsTable jobs={jobs} total={count} active={active} refreshError={refreshError} canRun={canRun} />
    </div>
  );
}
