import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { searchAuditLog } from "@/server/services/audit-log";
import { getOverview } from "@/server/services/overview";
import { openTasksDueFor } from "@/server/services/tasks";

import { ErrorState } from "../_components/pipeline/error-state";
import { PageHeader } from "../_components/pipeline/page-header";
import { KpiCards } from "./_components/kpi-cards";
import { MyTasksCard } from "./_components/my-tasks-card";
import { NoWorkspace } from "./_components/no-workspace";
import { PipelineCard } from "./_components/pipeline-card";
import { RecentActivity } from "./_components/recent-activity";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !context.workspace) return <NoWorkspace name={context.user.name} />;
  const role = context.workspace.role;

  const endOfToday = new Date();
  endOfToday.setUTCHours(23, 59, 59, 999);

  const data = await Promise.all([
    getOverview(actor),
    can(role, "task:read") ? openTasksDueFor(actor, context.user.id, endOfToday, 6) : Promise.resolve(null),
    can(role, "audit:read")
      ? searchAuditLog(actor, {}, { page: 1, perPage: 8, offset: 0 }).then((r) => r.auditLogs)
      : Promise.resolve(null),
  ]).catch((error: unknown) => {
    log.error("overview failed to load", { component: "overview", error });
    return null;
  });

  const firstName = context.user.name.split(" ")[0] || context.user.name;
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader title={`Welcome back, ${firstName}`} description={`What's happening in ${context.workspace.name}.`} />
      {data ? (
        <>
          <KpiCards overview={data[0]} />
          <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-12">
            {can(role, "deal:read") ? (
              <PipelineCard
                className="xl:col-span-7"
                pipeline={data[0].pipeline}
                openValue={data[0].openPipelineValue}
                openDeals={data[0].openDeals}
              />
            ) : null}
            {data[1] ? (
              <MyTasksCard
                className={can(role, "deal:read") ? "xl:col-span-5" : "xl:col-span-12"}
                tasks={data[1]}
                dueToday={data[0].myTasksDueToday}
                overdue={data[0].myTasksOverdue}
                now={data[0].generatedAt}
              />
            ) : null}
          </div>
          {data[2] ? <RecentActivity entries={data[2]} now={data[0].generatedAt} /> : null}
        </>
      ) : (
        <ErrorState />
      )}
    </div>
  );
}
