import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { getDashboard, type WidgetData, widgetData } from "@/server/services/dashboards";

import { buildCatalogue } from "../../_components/catalogue";
import { DashboardView } from "../../_components/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = actorFromContext(await getAppContext());
  if (!actor || !can(actor.role, "analytics:read")) notFound();
  const { id } = await params;
  const dashboard = await getDashboard(actor, id);
  // Each widget's numbers stream in on their own, so the header and layout render at once.
  const now = new Date();
  const data: Record<string, Promise<WidgetData>> = Object.fromEntries(
    dashboard.widgets.map((widget) => [widget.id, widgetData(actor, widget, now)]),
  );
  return (
    <DashboardView
      key={dashboard.updatedAt}
      dashboard={dashboard}
      data={data}
      catalogue={buildCatalogue()}
      canManage={can(actor.role, "dashboard:manage")}
    />
  );
}
