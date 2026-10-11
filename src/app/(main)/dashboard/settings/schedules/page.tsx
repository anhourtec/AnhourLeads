import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { log } from "@/server/log";
import { pageActor } from "@/server/services/engage-context";
import { listSchedules } from "@/server/services/schedules";

import { ErrorState } from "../../_components/pipeline/error-state";
import { PageHeader } from "../../_components/pipeline/page-header";
import { ScheduleManager } from "./_components/schedule-manager";

export const metadata: Metadata = { title: "Sending schedules" };

export default async function SchedulesPage() {
  const { actor } = await pageActor("sequence:read");
  const schedules = await listSchedules(actor).catch((error: unknown) => {
    log.error("schedules failed to load", { component: "schedules", error });
    return null;
  });
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Sequence defaults & schedules"
        description="Sequences send automatic emails only inside their schedule's weekly windows, in the schedule's time zone."
      />
      {schedules ? (
        <ScheduleManager schedules={schedules} canManage={can(actor.role, "schedule:manage")} />
      ) : (
        <ErrorState />
      )}
    </div>
  );
}
