"use client";

import { useState } from "react";

import Link from "next/link";

import { Plus, Sparkles, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDateTime, formatNumber, relativeTime } from "@/lib/format-display";
import { triggerEventLabel, WORKFLOW_TARGET_LABELS } from "@/lib/workflows";
import type { WorkflowDto } from "@/server/services/workflows";

import { PageHeader } from "../../_components/pipeline/page-header";
import { useUrlFilters } from "../../_components/pipeline/use-url-filters";
import { AutomatePrompt } from "./automate-prompt";
import { WorkflowStatusPill } from "./status-pill";
import { TemplateCard } from "./template-card";
import type { WorkflowTemplate } from "./templates";
import { useCreateWorkflow } from "./use-create-workflow";

function triggerText(w: WorkflowDto): string {
  if (w.triggerType === "schedule") {
    if (w.schedule?.weekly) return `Weekly at ${w.schedule.weekly.time}`;
    if (w.schedule?.at) return `Once, ${formatDateTime(w.schedule.at)}`;
    return "Schedule not set";
  }
  return triggerEventLabel(w.triggerEvent);
}

/** Workflows: list with status and runs, templates, and the automation prompt. */
export function WorkflowsView({
  tab,
  workflows,
  templates,
  canCreate,
}: {
  readonly tab: "workflows" | "templates";
  readonly workflows: WorkflowDto[];
  readonly templates: WorkflowTemplate[];
  readonly canCreate: boolean;
}) {
  const filters = useUrlFilters();
  const { create, pending } = useCreateWorkflow();
  const [copilot, setCopilot] = useState(false);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Workflows"
        description="Automate what happens when people engage, deals move or a schedule comes round."
        actions={
          canCreate ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setCopilot(true)}>
                <Sparkles data-icon="inline-start" />
                Outbound copilot
              </Button>
              <Button size="sm" asChild>
                <Link href="/dashboard/workflows/new">
                  <Plus data-icon="inline-start" />
                  Create workflow
                </Link>
              </Button>
            </>
          ) : null
        }
      />
      <Tabs value={tab} onValueChange={(v) => filters.set({ tab: v === "templates" ? "templates" : null })}>
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto border-b *:data-[slot=tabs-trigger]:flex-none"
        >
          <TabsTrigger value="workflows">
            Workflows <span className="font-mono text-muted-foreground text-xs">{formatNumber(workflows.length)}</span>
          </TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
        </TabsList>
        <TabsContent value="workflows" className="pt-4">
          {workflows.length ? (
            <div className="overflow-x-auto rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="table-head-mono pl-4">Name</TableHead>
                    <TableHead className="table-head-mono">Status</TableHead>
                    <TableHead className="table-head-mono">Target</TableHead>
                    <TableHead className="table-head-mono">Trigger</TableHead>
                    <TableHead className="table-head-mono text-right">Runs</TableHead>
                    <TableHead className="table-head-mono pr-4">Last run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workflows.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="max-w-72 pl-4">
                        <Link
                          href={`/dashboard/workflows/${w.id}`}
                          className="block truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {w.name}
                        </Link>
                        {w.owner ? <span className="text-muted-foreground text-xs">{w.owner.name}</span> : null}
                      </TableCell>
                      <TableCell>
                        <WorkflowStatusPill status={w.status} />
                      </TableCell>
                      <TableCell>{WORKFLOW_TARGET_LABELS[w.targetType]}</TableCell>
                      <TableCell className="max-w-56 truncate">{triggerText(w)}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatNumber(w.stats.runs)}
                        {w.stats.active ? (
                          <span className="text-muted-foreground text-xs">
                            {" "}
                            · {formatNumber(w.stats.active)} active
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="pr-4 text-muted-foreground">
                        {w.lastRunAt ? (
                          <span title={formatDateTime(w.lastRunAt)}>{relativeTime(w.lastRunAt)}</span>
                        ) : (
                          "Never"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Workflow aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>No workflows yet</EmptyTitle>
                <EmptyDescription>
                  Start from a template or build your own from a trigger and a few blocks.
                </EmptyDescription>
              </EmptyHeader>
              {canCreate ? (
                <EmptyContent>
                  <Button size="sm" asChild>
                    <Link href="/dashboard/workflows/new">
                      <Plus data-icon="inline-start" />
                      Create workflow
                    </Link>
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          )}
        </TabsContent>
        <TabsContent value="templates" className="pt-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onUse={(id) => void create(id)}
                pending={pending === t.id}
                canCreate={canCreate}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>
      <Dialog open={copilot} onOpenChange={setCopilot}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="page-title">What can I help automate?</DialogTitle>
            <DialogDescription>Describe it in a sentence and the matching workflow opens as a draft.</DialogDescription>
          </DialogHeader>
          <AutomatePrompt onTemplate={(id) => void create(id)} disabled={pending !== null} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
