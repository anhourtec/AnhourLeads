import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { type AnalyticsMetric, analyticsFilterOptions, queryAnalytics } from "@/server/services/analytics";
import { listDashboards } from "@/server/services/dashboards";

import { ErrorState } from "../_components/pipeline/error-state";
import { buildCatalogue } from "./_components/catalogue";
import { AnalyticsScreen, type OverviewKpi } from "./_components/dashboard-screen";

export const metadata: Metadata = { title: "Analytics" };

const DAY = 864e5;

export default async function AnalyticsPage() {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "analytics:read")) notFound();

  const now = new Date();
  const from = new Date(now.getTime() - 30 * DAY);
  const prevFrom = new Date(now.getTime() - 60 * DAY);
  const total = async (metric: AnalyticsMetric, a: Date, b: Date) =>
    (await queryAnalytics(actor, { metric, groupBy: "none", from: a, to: b })).total;
  const compare = async (metric: AnalyticsMetric, label: string, hint: string): Promise<OverviewKpi> => {
    const [value, previous] = await Promise.all([total(metric, from, now), total(metric, prevFrom, from)]);
    return { label, value, previous, currency: false, hint };
  };

  // The KPI strip streams in; the dashboards list and filters (cheap) render with the page.
  const kpis: Promise<OverviewKpi[] | null> = Promise.all([
    compare("emails_sent", "Emails sent", "Last 30 days"),
    compare("emails_replied", "Replies", "Last 30 days"),
    compare("verified_emails", "Emails verified as valid", "Last 30 days"),
    total("open_pipeline_value", from, now).then(
      (value): OverviewKpi => ({
        label: "Open pipeline value",
        value,
        previous: null,
        currency: true,
        hint: "Open deals right now",
      }),
    ),
  ]).catch((error: unknown) => {
    log.error("analytics KPIs failed to load", { component: "analytics", error });
    return null;
  });

  const loaded = await Promise.all([listDashboards(actor), analyticsFilterOptions(actor)]).catch((error: unknown) => {
    log.error("analytics failed to load", { component: "analytics", error });
    return null;
  });
  if (!loaded) return <ErrorState />;
  const [dashboards, options] = loaded;

  return (
    <AnalyticsScreen
      dashboards={dashboards.map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        ownerName: d.ownerName,
        starred: d.starred,
        shared: d.shared,
        widgetCount: d.widgets.length,
        updatedAt: d.updatedAt,
      }))}
      kpis={kpis}
      catalogue={buildCatalogue()}
      options={options}
      canManage={can(actor.role, "dashboard:manage")}
      today={now.toISOString().slice(0, 10)}
    />
  );
}
