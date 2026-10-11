"use client";

import { useEffect, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { BriefcaseBusiness, Globe, ListPlus, Lock, Maximize2, Phone, Plus, UserCheck, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CompanyDto } from "@/server/services/companies";
import type { CompanyInsights } from "@/server/services/company-insights";
import type { ContactDto } from "@/server/services/contacts";

import { AddToListDialog } from "../actions/add-to-list-dialog";
import { apiRequest } from "../api-client";
import { CompanyStagePill, ContactStagePill } from "../status-pills";
import { CompanyTile } from "./results-table";

export interface CompanyProfileData {
  company: CompanyDto;
  insights: CompanyInsights;
  people: ContactDto[];
  peopleTotal: number;
}

export interface CompanyProfilePermissions {
  update: boolean;
  listUpdate: boolean;
  listCreate: boolean;
}

const MONO_LABEL = "font-mono text-[11px] text-muted-foreground uppercase tracking-wider";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 text-sm">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

function ChipList({ values, max }: { values: string[]; max: number }) {
  const [all, setAll] = useState(false);
  if (!values.length) return null;
  const shown = all ? values : values.slice(0, max);
  return (
    <div className="flex flex-col items-start gap-1.5">
      <ul className="flex flex-wrap gap-1">
        {shown.map((v) => (
          <li key={v}>
            <Badge variant="secondary" className="max-w-56 truncate font-normal">
              {v}
            </Badge>
          </li>
        ))}
      </ul>
      {values.length > max ? (
        <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${values.length}`}
        </Button>
      ) : null}
    </div>
  );
}

function Description({ text }: { text: string | null }) {
  const [more, setMore] = useState(false);
  if (!text) return <p className="text-muted-foreground text-sm">No description yet.</p>;
  const long = text.length > 220;
  return (
    <p className="text-sm leading-relaxed">
      {long && !more ? `${text.slice(0, 220).trimEnd()}… ` : `${text} `}
      {long ? (
        <button
          type="button"
          className="rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setMore(!more)}
        >
          {more ? "Show less" : "Show more"}
        </button>
      ) : null}
    </p>
  );
}

function industryCodes(company: CompanyDto, pattern: RegExp): string[] {
  return Object.entries(company.customFields)
    .filter(([k, v]) => pattern.test(k) && v !== null && v !== "")
    .flatMap(([, v]) => String(v).split(/[,;]\s*/));
}

function NeedsProvider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
      <Lock className="size-4" aria-hidden="true" />
      {label} needs a data provider that this installation doesn't have configured.
    </div>
  );
}

const CXO = /\b(chief|ceo|cto|cfo|coo|cmo|cio|cro|founder|owner|president)\b/i;
const DIRECTOR_PLUS =
  /\b(chief|ceo|cto|cfo|coo|cmo|cio|cro|founder|owner|president|vp|vice president|head|director|partner)\b/i;

function PeopleTab({ data }: { data: CompanyProfileData }) {
  const [tab, setTab] = useState<"all" | "cxo" | "director">("all");
  const [q, setQ] = useState("");
  const test = tab === "cxo" ? CXO : tab === "director" ? DIRECTOR_PLUS : null;
  const people = data.people.filter(
    (p) =>
      (!test || test.test(p.title ?? "")) &&
      (!q || `${p.name} ${p.title ?? ""} ${p.email ?? ""}`.toLowerCase().includes(q.toLowerCase())),
  );
  const count = (re: RegExp | null) => data.people.filter((p) => !re || re.test(p.title ?? "")).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <TabsList>
            <TabsTrigger value="all">
              All <span className="font-mono text-muted-foreground tabular-nums">{count(null)}</span>
            </TabsTrigger>
            <TabsTrigger value="cxo">
              CXO <span className="font-mono text-muted-foreground tabular-nums">{count(CXO)}</span>
            </TabsTrigger>
            <TabsTrigger value="director">
              Director+ <span className="font-mono text-muted-foreground tabular-nums">{count(DIRECTOR_PLUS)}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          aria-label="Search people at this company"
          placeholder="Search people"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-7 w-full text-sm sm:w-48"
        />
      </div>
      {people.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {["Name", "Job title", "Email", "Stage"].map((h) => (
                  <th key={h} scope="col" className={`${MONO_LABEL} border-b px-3 py-2 text-left font-normal`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id} className="border-b last:border-b-0">
                  <td className="px-3 py-2">
                    <Link href={`/dashboard/people/${p.id}`} className="font-medium underline-offset-4 hover:underline">
                      {p.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{p.title ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.email ?? <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <ContactStagePill stage={p.stage} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No people here match.</p>
      )}
      {data.peopleTotal > data.people.length ? (
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link href={`/dashboard/people?companyId=${data.company.id}`}>
            View all {data.peopleTotal.toLocaleString("en-US")} in people search
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

function SuggestedPeople({ data }: { data: CompanyProfileData }) {
  const people = data.insights.suggestedPeople;
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="font-medium text-base">Suggested people</CardTitle>
        <p className="text-muted-foreground text-xs">
          {data.insights.lastCrawledAt
            ? `Found on the company's public website · ${new Date(data.insights.lastCrawledAt).toLocaleDateString("en-US")}`
            : "Research the company's website to find people who aren't contacts yet."}
        </p>
      </CardHeader>
      <CardContent>
        {people.length ? (
          <ul className="flex flex-col divide-y">
            {people.map((p) => (
              <li key={`${p.name}-${p.sourceUrl}`} className="flex flex-col gap-0.5 py-2">
                <span className="font-medium text-sm">{p.name}</span>
                <span className="text-muted-foreground text-xs">{p.title ?? "Title unknown"}</span>
                <span className="truncate font-mono text-muted-foreground text-xs">
                  {p.email ?? new URL(p.sourceUrl).pathname} · {Math.round(p.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No suggestions yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Company header, details card and Overview / People / Locations tabs (drawer and page). */
export function CompanyProfile({
  data,
  permissions,
  currentUserId,
  variant,
  onClose,
  extraActions,
}: {
  data: CompanyProfileData;
  permissions: CompanyProfilePermissions;
  currentUserId: string;
  variant: "drawer" | "page";
  onClose?: () => void;
  /** Page-only actions (edit, delete) shown after the main ones. */
  extraActions?: React.ReactNode;
}) {
  const router = useRouter();
  const { company, insights } = data;
  const [listOpen, setListOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ownerId, setOwnerId] = useState(company.ownerId);
  useEffect(() => setOwnerId(company.ownerId), [company.ownerId]);
  const saved = ownerId === currentUserId;
  const place = [company.city, company.state, company.country].filter(Boolean).join(", ");
  const sic = industryCodes(company, /sic/i);
  const naics = industryCodes(company, /naics/i);
  const TitleTag = variant === "page" ? "h1" : "h2";

  async function save() {
    setSaving(true);
    const res = await apiRequest("/api/v1/accounts/update_owners", {
      body: { accountIds: [company.id], ownerId: currentUserId },
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setOwnerId(currentUserId);
    toast.success(`${company.name} is saved to you.`);
    router.refresh();
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <nav aria-label="Breadcrumb" className="text-muted-foreground text-xs">
        <ol className="flex items-center gap-1.5">
          <li>
            <Link href="/dashboard/companies" className="hover:underline">
              Companies
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li className="truncate text-foreground" aria-current="page">
            {company.name}
          </li>
        </ol>
      </nav>
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <CompanyTile name={company.name} className="size-10 text-base" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <TitleTag className="break-words font-medium text-xl tracking-tight">{company.name}</TitleTag>
              {company.linkedinUrl ? (
                <a
                  href={company.linkedinUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`${company.name} on LinkedIn`}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <BriefcaseBusiness className="size-4" aria-hidden="true" />
                </a>
              ) : null}
              {company.websiteUrl ? (
                <a
                  href={company.websiteUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={`${company.name} website`}
                  className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Globe className="size-4" aria-hidden="true" />
                </a>
              ) : null}
            </div>
            <p className="text-muted-foreground text-sm">
              {[company.industry, place].filter(Boolean).join(" · ") || "Industry and location unknown"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {permissions.listUpdate ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setListOpen(true)}>
              <ListPlus data-icon="inline-start" aria-hidden="true" />
              Add to list
            </Button>
          ) : null}
          {permissions.update ? (
            <Button type="button" size="sm" disabled={saved || saving} onClick={() => void save()}>
              {saved ? (
                <UserCheck data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Plus data-icon="inline-start" aria-hidden="true" />
              )}
              {saved ? "Saved" : saving ? "Saving…" : "Save company"}
            </Button>
          ) : null}
          {extraActions}
          {variant === "drawer" ? (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button asChild variant="ghost" size="icon-sm">
                    <Link href={`/dashboard/companies/${company.id}`} aria-label="Open the full company page">
                      <Maximize2 aria-hidden="true" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open the full page</TooltipContent>
              </Tooltip>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
                <X aria-hidden="true" />
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <Card className="h-fit gap-2">
          <CardHeader>
            <CardTitle className="font-medium text-base">Company details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Description text={company.description} />
            <dl className="divide-y">
              <DetailRow label="Industries">
                {company.industry ? <ChipList values={[company.industry]} max={3} /> : null}
              </DetailRow>
              <DetailRow label="Keywords">
                {company.keywords.length ? <ChipList values={company.keywords} max={4} /> : null}
              </DetailRow>
              <DetailRow label="Founding year">
                {company.foundedYear ? <span className="font-mono tabular-nums">{company.foundedYear}</span> : null}
              </DetailRow>
              <DetailRow label="Number of employees">
                {company.employeeCount != null ? (
                  <span className="font-mono tabular-nums">
                    {company.employeeCount.toLocaleString("en-US")} employees
                  </span>
                ) : null}
              </DetailRow>
              <DetailRow label="Revenue">
                {company.annualRevenue != null ? (
                  <span className="font-mono tabular-nums">
                    {company.annualRevenue.toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    })}
                  </span>
                ) : null}
              </DetailRow>
              {sic.length ? (
                <DetailRow label="SIC codes">
                  <ChipList values={sic} max={4} />
                </DetailRow>
              ) : null}
              {naics.length ? (
                <DetailRow label="NAICS codes">
                  <ChipList values={naics} max={4} />
                </DetailRow>
              ) : null}
              <DetailRow label="Stage">
                <CompanyStagePill stage={company.stage} />
              </DetailRow>
              <DetailRow label="Owner">
                {company.owner?.name ?? <span className="text-muted-foreground">Unassigned</span>}
              </DetailRow>
              <DetailRow label="Phone">
                {company.phone ? (
                  <a href={`tel:${company.phone}`} className="inline-flex items-center gap-1 font-mono text-xs">
                    <Phone className="size-3.5" aria-hidden="true" />
                    {company.phone}
                  </a>
                ) : null}
              </DetailRow>
              <DetailRow label="Lists">
                {insights.lists.length ? (
                  <ul className="flex flex-wrap gap-1">
                    {insights.lists.map((l) => (
                      <li key={l.id}>
                        <Link
                          href={`/dashboard/lists/${l.id}`}
                          className="text-primary text-sm underline-offset-4 hover:underline"
                        >
                          {l.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">Not in any list</span>
                )}
              </DetailRow>
              <DetailRow label="Links">
                {company.domain ? <span className="font-mono text-xs">{company.domain}</span> : null}
              </DetailRow>
            </dl>
          </CardContent>
        </Card>

        <Tabs defaultValue="overview" className="min-w-0 gap-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="people">
              People <span className="font-mono text-muted-foreground tabular-nums">{data.peopleTotal}</span>
            </TabsTrigger>
            <TabsTrigger value="locations">Locations</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="flex min-w-0 flex-col gap-4">
            <Card className="gap-3">
              <CardHeader>
                <CardTitle className="font-medium text-base">Company insights</CardTitle>
              </CardHeader>
              <CardContent>
                <Tabs defaultValue="overview" className="gap-3">
                  <div className="overflow-x-auto">
                    <TabsList className="w-max">
                      <TabsTrigger value="overview">Overview</TabsTrigger>
                      <TabsTrigger value="technologies">
                        Technologies{" "}
                        <span className="font-mono text-muted-foreground tabular-nums">
                          {company.technologies.length}
                        </span>
                      </TabsTrigger>
                      <TabsTrigger value="news">News</TabsTrigger>
                      <TabsTrigger value="funding">Funding</TabsTrigger>
                      <TabsTrigger value="jobs">Job postings</TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value="overview">
                    <dl className="divide-y">
                      <DetailRow label="Technologies">
                        {company.technologies.length ? (
                          <ChipList values={company.technologies} max={6} />
                        ) : (
                          <span className="text-muted-foreground">None found yet</span>
                        )}
                      </DetailRow>
                      <DetailRow label="People saved">
                        <span className="font-mono tabular-nums">{data.peopleTotal.toLocaleString("en-US")}</span>
                      </DetailRow>
                      <DetailRow label="Last activity">
                        {company.lastActivityAt ? new Date(company.lastActivityAt).toLocaleDateString("en-US") : null}
                      </DetailRow>
                      <DetailRow label="Enriched">
                        {company.lastEnrichedAt
                          ? new Date(company.lastEnrichedAt).toLocaleDateString("en-US")
                          : "Never"}
                      </DetailRow>
                    </dl>
                  </TabsContent>
                  <TabsContent value="technologies">
                    {company.technologies.length ? (
                      <ChipList values={company.technologies} max={50} />
                    ) : (
                      <p className="text-muted-foreground text-sm">
                        No technologies yet. Researching the company website detects the tools it uses.
                      </p>
                    )}
                  </TabsContent>
                  <TabsContent value="news">
                    <NeedsProvider label="News" />
                  </TabsContent>
                  <TabsContent value="funding">
                    <NeedsProvider label="Funding data" />
                  </TabsContent>
                  <TabsContent value="jobs">
                    <NeedsProvider label="Job postings" />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
            <SuggestedPeople data={data} />
          </TabsContent>
          <TabsContent value="people" className="min-w-0">
            <PeopleTab data={data} />
          </TabsContent>
          <TabsContent value="locations">
            <Card className="gap-3">
              <CardHeader>
                <CardTitle className="font-medium text-base">Locations</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div>
                  <p className={MONO_LABEL}>Headquarters</p>
                  <p className="text-sm">{place || "Unknown"}</p>
                </div>
                {insights.peopleLocations.length ? (
                  <div>
                    <p className={MONO_LABEL}>Where its people are</p>
                    <ul className="flex flex-col gap-1">
                      {insights.peopleLocations.map((l) => (
                        <li key={l.location} className="flex justify-between gap-2 text-sm">
                          <span>{l.location}</span>
                          <span className="font-mono text-muted-foreground tabular-nums">{l.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      {permissions.listUpdate ? (
        <AddToListDialog
          open={listOpen}
          onOpenChange={setListOpen}
          entityType="company"
          ids={[company.id]}
          canCreate={permissions.listCreate}
        />
      ) : null}
    </div>
  );
}
