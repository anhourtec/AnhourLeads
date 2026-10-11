"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { DataHealth, DuplicateGroup, JobChange } from "@/server/services/data-health";
import type { AutomationView, EnrichmentJobView } from "@/server/services/enrichment-jobs";

import { PageHeader } from "../../_components/pipeline/page-header";
import { AutomateDialog } from "./automate-dialog";
import { CsvTab } from "./csv-tab";
import { HealthCenter } from "./health-center";
import { JobChangesTab } from "./job-changes-tab";
import { ResearchTab } from "./research-tab";
import { ScheduledJobsSheet } from "./scheduled-jobs-sheet";
import type { EnrichmentPermissions } from "./types";

type Tab = "health" | "csv" | "job-changes" | "research";

export function EnrichmentScreen({
  initialTab,
  health,
  duplicates,
  jobChanges,
  csvJobs,
  activeJobs,
  automation,
  permissions,
}: {
  initialTab: Tab;
  health: DataHealth;
  duplicates: DuplicateGroup[];
  jobChanges: JobChange[];
  csvJobs: EnrichmentJobView[];
  activeJobs: EnrichmentJobView[];
  automation: AutomationView;
  permissions: EnrichmentPermissions;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [schedule, setSchedule] = useState(automation);

  const changeTab = (next: string) => {
    setTab(next as Tab);
    try {
      const url = new URL(window.location.href);
      if (next === "health") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.replaceState(null, "", url);
    } catch {
      // The tab still changes; only the shareable URL is missed.
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 md:gap-6">
      <PageHeader
        title="Data enrichment"
        description="Keep your records complete and current: find missing emails, verify addresses, fill company details and merge duplicates. Every value shows where it came from."
        actions={
          <>
            <ScheduledJobsSheet initialJobs={activeJobs} automation={schedule} />
            {permissions.enrich ? <AutomateDialog automation={schedule} onSaved={setSchedule} /> : null}
          </>
        }
      />
      <Tabs value={tab} onValueChange={changeTab} className="min-w-0 gap-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList variant="line" aria-label="Data enrichment sections">
            <TabsTrigger value="health">Data health center</TabsTrigger>
            <TabsTrigger value="csv">CSV</TabsTrigger>
            <TabsTrigger value="job-changes">
              Job changes
              {jobChanges.length ? (
                <span className="font-mono text-muted-foreground text-xs tabular-nums">{jobChanges.length}</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="research">Research</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="health" className="min-w-0">
          <HealthCenter health={health} duplicates={duplicates} permissions={permissions} />
        </TabsContent>
        <TabsContent value="csv" className="min-w-0">
          <CsvTab initialJobs={csvJobs} permissions={permissions} />
        </TabsContent>
        <TabsContent value="job-changes" className="min-w-0">
          <JobChangesTab initialChanges={jobChanges} canUpdate={permissions.updateContacts} />
        </TabsContent>
        <TabsContent value="research" className="min-w-0">
          <ResearchTab canOpen={permissions.research} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
