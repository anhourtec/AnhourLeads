"use client";

import Link from "next/link";

import { ChevronRight, Filter, PencilRuler } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeFilters, type EnrollmentFilters, WORKFLOW_TARGET_LABELS, type WorkflowTarget } from "@/lib/workflows";

import { AutomatePrompt } from "./automate-prompt";
import { WorkflowStatusPill } from "./status-pill";
import { TemplateCard } from "./template-card";
import type { WorkflowTemplate } from "./templates";
import { useCreateWorkflow } from "./use-create-workflow";

/** Criteria carried over from a search or a list. */
export interface Prefill {
  source: "search" | "list";
  listName?: string;
  targetType: WorkflowTarget;
  enrollmentFilters: EnrollmentFilters;
  triggerType?: "event" | "schedule";
  triggerEvent?: string;
  dropped: string[];
}

/** First screen of a new workflow: describe it, pick one of three templates, or start from scratch. */
export function StartScreen({
  templates,
  prefill = null,
}: {
  readonly templates: WorkflowTemplate[];
  readonly prefill?: Prefill | null;
}) {
  const { create: createRaw, pending } = useCreateWorkflow();
  const extra = (templateTarget?: WorkflowTarget): Record<string, unknown> => {
    if (!prefill || (templateTarget && templateTarget !== prefill.targetType)) return {};
    return {
      targetType: prefill.targetType,
      enrollmentFilters: prefill.enrollmentFilters,
      ...(templateTarget ? {} : { triggerType: prefill.triggerType ?? "event" }),
      ...(prefill.triggerEvent && !templateTarget ? { triggerEvent: prefill.triggerEvent } : {}),
    };
  };
  const create = (templateId?: string) =>
    createRaw(templateId, extra(templateId ? templates.find((t) => t.id === templateId)?.targetType : undefined));
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-muted-foreground text-xs">
        <Link href="/dashboard/workflows" className="hover:text-foreground hover:underline">
          Workflows
        </Link>
        <ChevronRight className="size-3" aria-hidden="true" />
        <span className="text-foreground">New workflow</span>
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="page-title">New workflow</h1>
        <WorkflowStatusPill status="draft" />
      </div>
      {prefill ? (
        <Alert>
          <Filter aria-hidden="true" />
          <AlertDescription>
            {prefill.source === "list"
              ? `Starts with people in the list “${prefill.listName ?? ""}”.`
              : "Starts with your search criteria."}{" "}
            {WORKFLOW_TARGET_LABELS[prefill.targetType]}: {describeFilters(prefill.enrollmentFilters)}.
            {prefill.dropped.length
              ? ` Some filters can't be used as enrollment criteria yet: ${prefill.dropped.join(", ")}.`
              : ""}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-6 py-6">
        <section className="flex w-full flex-col items-center gap-5 rounded-2xl border bg-card p-4 sm:p-8">
          <h2 className="page-title text-center">What can I help automate?</h2>
          <AutomatePrompt onTemplate={(id) => void create(id)} disabled={pending !== null} />
          <div className="grid w-full gap-3 md:grid-cols-3">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onUse={(id) => void create(id)}
                pending={pending === t.id}
                canCreate
              />
            ))}
          </div>
          <Button variant="link" size="sm" asChild>
            <Link href="/dashboard/workflows?tab=templates">Explore all templates</Link>
          </Button>
        </section>
        <div className="flex w-full max-w-sm items-center gap-3 text-muted-foreground text-xs" aria-hidden="true">
          <span className="h-px flex-1 bg-border" />
          OR
          <span className="h-px flex-1 bg-border" />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full max-w-sm"
          disabled={pending !== null}
          onClick={() => void create()}
        >
          <PencilRuler data-icon="inline-start" />
          {pending === "blank" ? "Creating…" : "Start from scratch"}
        </Button>
      </div>
    </div>
  );
}
