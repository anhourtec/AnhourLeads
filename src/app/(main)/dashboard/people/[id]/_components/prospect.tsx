"use client";

import { useState } from "react";

import Link from "next/link";

import { Building2, Globe, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Small uppercase mono label for a definition list row. */
export function MonoLabel({ children }: { children: React.ReactNode }) {
  return <dt className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider">{children}</dt>;
}

interface InsightCompany {
  id: string;
  name: string;
  domain: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  description: string | null;
  industry: string | null;
  keywords: string[];
  technologies: string[];
  employeeCount: number | null;
  annualRevenue: number | null;
  foundedYear: number | null;
  city: string | null;
  state: string | null;
  country: string | null;
  phone: string | null;
}

function Chips({ items, limit, label }: { items: string[]; limit: number; label: string }) {
  const [all, setAll] = useState(false);
  if (!items.length) return <span className="text-muted-foreground">None recorded</span>;
  const shown = all ? items : items.slice(0, limit);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((item) => (
        <Badge key={item} variant="secondary" className="max-w-full truncate font-normal">
          {item}
        </Badge>
      ))}
      {items.length > limit ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-1"
          aria-label={all ? `Show fewer ${label}` : `Show all ${items.length} ${label}`}
          onClick={() => setAll((v) => !v)}
        >
          {all ? "Show less" : `Show all ${items.length}`}
        </Button>
      ) : null}
    </div>
  );
}

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280;
  return (
    <p className="max-w-prose whitespace-pre-line break-words text-sm">
      {long && !open ? `${text.slice(0, 280).trimEnd()}… ` : `${text} `}
      {long ? (
        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => setOpen((v) => !v)}>
          {open ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </p>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">{children}</dl>;
}

/** Prospect tab: what we know about the person's company, and what needs a data provider. */
export function CompanyInsights({
  company,
  location,
  companyStageLabel,
}: {
  company: InsightCompany | null;
  location: string;
  companyStageLabel: string | null;
}) {
  if (!company) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
        <Building2 className="size-5 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium text-sm">No company linked</p>
        <p className="max-w-sm text-muted-foreground text-sm">
          Link this person to a company to see its details here.
          {location ? ` They are based in ${location}.` : ""}
        </p>
      </div>
    );
  }
  const companyLocation = [company.city, company.state, company.country].filter(Boolean).join(", ");
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section aria-labelledby="insights-title" className="flex flex-col gap-4 rounded-xl border p-4 md:p-5">
        <h2 id="insights-title" className="font-medium text-base">
          Company insights
        </h2>
        <Grid>
          <MonoLabel>Technologies</MonoLabel>
          <dd className="min-w-0">
            <Chips items={company.technologies} limit={8} label="technologies" />
          </dd>
          {(["News", "Funding", "Job postings"] as const).map((label) => (
            <div key={label} className="contents">
              <MonoLabel>{label}</MonoLabel>
              <dd className="flex items-center gap-1.5 text-muted-foreground">
                <Lock className="size-3.5" aria-hidden="true" />
                Needs a data provider
              </dd>
            </div>
          ))}
        </Grid>
      </section>
      <section aria-labelledby="company-card-title" className="flex flex-col gap-4 rounded-xl border p-4 md:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted font-medium font-mono text-sm"
          >
            {company.name.slice(0, 1).toUpperCase()}
          </span>
          <h2 id="company-card-title" className="min-w-0 font-medium text-base">
            <Link
              href={`/dashboard/companies/${company.id}`}
              className="break-words underline-offset-4 hover:underline"
            >
              {company.name}
            </Link>
          </h2>
          {company.domain ? (
            <a
              href={company.websiteUrl ?? `https://${company.domain}`}
              target="_blank"
              rel="noreferrer noopener"
              aria-label="Company website"
              className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Globe className="size-4" aria-hidden="true" />
            </a>
          ) : null}
        </div>
        {company.description ? <Description text={company.description} /> : null}
        <Grid>
          <MonoLabel>Keywords</MonoLabel>
          <dd className="min-w-0">
            <Chips items={company.keywords} limit={6} label="keywords" />
          </dd>
          <MonoLabel>Industry</MonoLabel>
          <dd>{company.industry ?? <span className="text-muted-foreground">Unknown</span>}</dd>
          <MonoLabel>Employees</MonoLabel>
          <dd className="font-mono tabular-nums">
            {company.employeeCount?.toLocaleString("en-US") ?? (
              <span className="font-sans text-muted-foreground">Unknown</span>
            )}
          </dd>
          <MonoLabel>Founded</MonoLabel>
          <dd className="font-mono tabular-nums">
            {company.foundedYear ?? <span className="font-sans text-muted-foreground">Unknown</span>}
          </dd>
          <MonoLabel>Revenue</MonoLabel>
          <dd className="font-mono tabular-nums">
            {company.annualRevenue !== null ? (
              company.annualRevenue.toLocaleString("en-US", {
                style: "currency",
                currency: "USD",
                maximumFractionDigits: 0,
              })
            ) : (
              <span className="font-sans text-muted-foreground">Unknown</span>
            )}
          </dd>
          <MonoLabel>Location</MonoLabel>
          <dd>{companyLocation || <span className="text-muted-foreground">Unknown</span>}</dd>
          <MonoLabel>Stage</MonoLabel>
          <dd>{companyStageLabel}</dd>
          <MonoLabel>Phone</MonoLabel>
          <dd className="font-mono">
            {company.phone ?? <span className="font-sans text-muted-foreground">None</span>}
          </dd>
        </Grid>
      </section>
    </div>
  );
}
