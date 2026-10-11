"use client";

import { Suspense, use, useState } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ChevronDown, FileBarChart, LayoutDashboard, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { PageHeader } from "../../_components/pipeline/page-header";
import { DashboardCreateDialog } from "./dashboard-create-dialog";
import { DashboardList, type DashboardSummary, StarButton } from "./dashboard-list";
import { type FilterOptions, ReportBuilder } from "./report-builder";
import { type Catalogue, formatValue } from "./widget-format";

export interface OverviewKpi {
  label: string;
  value: number;
  previous: number | null;
  currency: boolean;
  hint: string;
}

const TABS = ["overview", "dashboards", "reports"] as const;
type Tab = (typeof TABS)[number];

function Change({ value, previous }: { value: number; previous: number | null }) {
  if (previous === null) return null;
  if (previous === 0) {
    return <span className="text-muted-foreground text-xs">{value === 0 ? "No change" : "New this period"}</span>;
  }
  const pct = Math.round(((value - previous) / previous) * 100);
  return (
    <span className="text-muted-foreground text-xs">
      <span className="font-mono tabular-nums">
        {pct > 0 ? "+" : ""}
        {pct}%
      </span>{" "}
      vs previous 30 days
    </span>
  );
}

export function AnalyticsScreen({
  dashboards,
  kpis,
  catalogue,
  options,
  canManage,
  today,
}: {
  dashboards: DashboardSummary[];
  /** Streamed from the server; null when the numbers couldn't load. */
  kpis: Promise<OverviewKpi[] | null>;
  catalogue: Catalogue;
  options: FilterOptions;
  canManage: boolean;
  today: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const initial = search.get("tab");
  const [tab, setTab] = useState<Tab>(
    (TABS as readonly string[]).includes(initial ?? "") ? (initial as Tab) : "overview",
  );
  const [creating, setCreating] = useState(false);

  function changeTab(next: string) {
    const value = (TABS as readonly string[]).includes(next) ? (next as Tab) : "overview";
    setTab(value);
    const params = new URLSearchParams(search.toString());
    if (value === "overview") params.delete("tab");
    else params.set("tab", value);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const system = dashboards.filter((d) => d.kind === "system");
  const starred = dashboards.filter((d) => d.starred);
  const recent = dashboards
    .filter((d) => d.kind === "custom")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Analytics"
        description="Dashboards and reports built from your workspace's own activity: emails, calls, tasks, deals and data quality."
        actions={
          canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm">
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  Create
                  <ChevronDown data-icon="inline-end" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setCreating(true)}>
                  <LayoutDashboard aria-hidden="true" />
                  Dashboard
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => changeTab("reports")}>
                  <FileBarChart aria-hidden="true" />
                  Report
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null
        }
      />

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="dashboards">Dashboards</TabsTrigger>
          <TabsTrigger value="reports">Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4 pt-2 md:gap-6">
          <section aria-label="Last 30 days" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Suspense fallback={<KpiSkeletons />}>
              <OverviewKpis kpis={kpis} />
            </Suspense>
          </section>

          {starred.length || recent.length ? (
            <section className="flex flex-col gap-3">
              <h2 className="font-medium text-base">{starred.length ? "Starred and recent" : "Recent dashboards"}</h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[...starred, ...recent.filter((r) => !r.starred)].slice(0, 8).map((d) => (
                  <DashboardCard key={d.id} dashboard={d} canManage={canManage} />
                ))}
              </div>
            </section>
          ) : null}

          <section className="flex flex-col gap-3">
            <h2 className="font-medium text-base">System dashboards</h2>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {system.map((d) => (
                <DashboardCard key={d.id} dashboard={d} canManage={canManage} />
              ))}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="dashboards" className="pt-2">
          <DashboardList dashboards={dashboards} canManage={canManage} />
        </TabsContent>

        <TabsContent value="reports" className="pt-2">
          <ReportBuilder catalogue={catalogue} options={options} today={today} />
        </TabsContent>
      </Tabs>

      {canManage ? <DashboardCreateDialog open={creating} onOpenChange={setCreating} /> : null}
    </div>
  );
}

function KpiSkeletons() {
  return (
    <>
      {["sent", "replies", "verified", "pipeline"].map((k) => (
        <Card key={k} className="gap-2" aria-busy="true">
          <CardHeader>
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-20" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-3 w-32" />
          </CardContent>
        </Card>
      ))}
      <span className="sr-only">Loading the last 30 days</span>
    </>
  );
}

function OverviewKpis({ kpis }: { kpis: Promise<OverviewKpi[] | null> }) {
  const loaded = use(kpis);
  if (!loaded) {
    return (
      <p className="text-muted-foreground text-sm sm:col-span-2 xl:col-span-4">
        The last 30 days couldn't load. Refresh the page to try again.
      </p>
    );
  }
  return (
    <>
      {loaded.map((k) => (
        <Card key={k.label} className="gap-2">
          <CardHeader>
            <CardDescription>{k.label}</CardDescription>
            <CardTitle className="font-medium font-mono text-2xl tabular-nums">
              {formatValue(k.value, k.currency)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-0.5">
            <Change value={k.value} previous={k.previous} />
            <span className="text-muted-foreground text-xs">{k.hint}</span>
          </CardContent>
        </Card>
      ))}
    </>
  );
}

const SYSTEM_BLURBS: Record<string, string> = {
  "Data enrichment & quality": "Verified emails, enrichment jobs and rows enriched.",
  "Engagement performance": "Emails sent, delivered, bounced and replied, per day and per rep.",
  "Sequence performance": "How each sequence sends and gets replies.",
  Pipeline: "Open value by stage, won and lost per month, by owner.",
  "Sales manager command center": "Every rep's emails, replies, calls and tasks side by side.",
};

function DashboardCard({ dashboard, canManage }: { dashboard: DashboardSummary; canManage: boolean }) {
  return (
    <Card className="gap-2">
      <CardHeader>
        <CardTitle className="text-base">
          <Link href={`/dashboard/analytics/dashboards/${dashboard.id}`} className="hover:underline">
            {dashboard.name}
          </Link>
        </CardTitle>
        <CardAction>
          <StarButton dashboard={dashboard} canManage={canManage} />
        </CardAction>
        <CardDescription className="text-xs">
          {SYSTEM_BLURBS[dashboard.name] ??
            `${dashboard.widgetCount} ${dashboard.widgetCount === 1 ? "widget" : "widgets"} · ${dashboard.ownerName ?? "Former member"}`}
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
