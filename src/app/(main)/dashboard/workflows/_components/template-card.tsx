"use client";

import { GitBranch, GitCommitVertical, Tag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { BLOCK_INFO, triggerEventLabel, WORKFLOW_TARGET_LABELS } from "@/lib/workflows";
import type { TemplateBlock } from "@/server/services/workflows";

import type { WorkflowTemplate } from "./templates";

function BlockList({ blocks, depth = 0 }: { blocks: TemplateBlock[]; depth?: number }) {
  return (
    <ol className="flex flex-col gap-1.5" style={{ marginLeft: depth ? 16 : 0 }}>
      {blocks.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: template blocks are a fixed ordered list without ids
        <li key={`${b.type}-${i}`} className="flex flex-col gap-1.5">
          <span className="rounded-md border bg-card px-2.5 py-1.5 text-sm">{BLOCK_INFO[b.type].label}</span>
          {b.branches
            ? Object.entries(b.branches).map(([key, child]) => (
                <div key={key} className="flex flex-col gap-1">
                  <span className="table-head-mono ml-4">{key}</span>
                  {child.length ? (
                    <BlockList blocks={child} depth={depth + 1} />
                  ) : (
                    <span className="ml-4 text-muted-foreground text-xs">Exit</span>
                  )}
                </div>
              ))
            : null}
        </li>
      ))}
    </ol>
  );
}

/** A template card: kind and tags, name, summary, preview and use. */
export function TemplateCard({
  template,
  onUse,
  pending,
  canCreate,
}: {
  readonly template: WorkflowTemplate;
  readonly onUse: (id: string) => void;
  readonly pending: boolean;
  readonly canCreate: boolean;
}) {
  const Kind = template.kind === "linear" ? GitCommitVertical : GitBranch;
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4" data-testid={`template-${template.id}`}>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="secondary" className="gap-1 bg-muted text-muted-foreground">
          <Kind className="size-3" aria-hidden="true" />
          {template.kind === "linear" ? "Linear" : "Multi-branch"}
        </Badge>
        {template.tags.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1 bg-sky-500/10 text-sky-700 dark:text-sky-400">
            <Tag className="size-3" aria-hidden="true" />
            {t}
          </Badge>
        ))}
      </div>
      <h3 className="font-medium text-sm">{template.name}</h3>
      <p className="line-clamp-2 text-muted-foreground text-xs">{template.description}</p>
      <div className="mt-auto flex flex-wrap gap-2 pt-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              Preview
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{template.name}</DialogTitle>
              <DialogDescription>{template.description}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 text-sm">
              <div className="rounded-md border border-dashed px-3 py-2">
                <span className="table-head-mono">When this happens</span>
                <p>
                  {template.triggerType === "schedule" ? "On a schedule" : triggerEventLabel(template.triggerEvent)} ·{" "}
                  {WORKFLOW_TARGET_LABELS[template.targetType]}
                </p>
              </div>
              <BlockList blocks={template.blocks} />
              <span className="text-muted-foreground text-xs">Then exit.</span>
            </div>
            <DialogFooter>
              {canCreate ? (
                <Button size="sm" disabled={pending} onClick={() => onUse(template.id)}>
                  Use template
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {canCreate ? (
          <Button size="sm" disabled={pending} onClick={() => onUse(template.id)}>
            {pending ? "Creating…" : "Use template"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
