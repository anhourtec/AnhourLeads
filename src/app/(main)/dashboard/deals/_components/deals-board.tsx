"use client";

import { useRef, useState } from "react";

import { cn } from "cn";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDate, formatMoney, formatNumber } from "@/lib/format-display";
import type { DealDto, PipelineStageTotal } from "@/server/services/deals";
import type { PipelineDto } from "@/server/services/pipelines";

const COLUMN_TONE: Record<string, string> = {
  open: "bg-muted/40",
  won: "bg-emerald-500/5",
  lost: "bg-destructive/5",
};

function DealCard({
  deal,
  draggable,
  onOpen,
  onDragStart,
}: {
  deal: DealDto;
  draggable: boolean;
  onOpen: (deal: DealDto) => void;
  onDragStart: (deal: DealDto) => void;
}) {
  return (
    <li data-testid={`deal-card-${deal.id}`} className="rounded-lg border bg-card shadow-xs">
      <button
        type="button"
        draggable={draggable}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", deal.id);
          onDragStart(deal);
        }}
        onClick={() => onOpen(deal)}
        className={cn(
          "flex w-full flex-col gap-1.5 rounded-lg p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
          draggable && "cursor-grab active:cursor-grabbing",
        )}
      >
        <span className="min-w-0 break-words font-medium text-sm">{deal.name}</span>
        {deal.company || deal.contact ? (
          <span className="truncate text-muted-foreground text-xs">
            {[deal.company?.name, deal.contact?.name].filter(Boolean).join(" · ")}
          </span>
        ) : null}
        <span className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium font-mono tabular-nums">{formatMoney(deal.amount, deal.currency)}</span>
          <span className="truncate text-muted-foreground">
            {deal.closeDate ? `Closes ${formatDate(deal.closeDate)}` : (deal.owner?.name ?? "")}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Kanban board for one pipeline: a column per stage with its count and total. Cards drag between
 * columns (deal:update); the move is shown at once and rolled back if the server refuses it.
 */
export function DealsBoard({
  pipeline,
  deals,
  totals,
  canUpdate,
  canCreate,
  onMove,
  onOpen,
  onCreate,
}: {
  readonly pipeline: PipelineDto;
  readonly deals: DealDto[];
  readonly totals: PipelineStageTotal[];
  readonly canUpdate: boolean;
  readonly canCreate: boolean;
  readonly onMove: (deal: DealDto, stageId: string) => void;
  readonly onOpen: (deal: DealDto) => void;
  readonly onCreate: (stageId: string) => void;
}) {
  // A ref, not state: dragover fires before a re-render would land.
  const dragging = useRef<DealDto | null>(null);
  const [over, setOver] = useState<string | null>(null);

  return (
    <section aria-label="Deals by stage" className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
      <div className="flex w-max gap-3">
        {pipeline.stages.map((stage) => {
          const total = totals.find((t) => t.stageId === stage.id);
          const items = deals.filter((d) => d.stageId === stage.id);
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: drop target for mouse drags; keyboard users move deals with the stage select in the deal drawer
            <div
              key={stage.id}
              data-testid={`stage-${stage.id}`}
              data-stage-name={stage.name}
              onDragOver={(e) => {
                if (!dragging.current || !canUpdate) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (over !== stage.id) setOver(stage.id);
              }}
              onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const moved = dragging.current;
                dragging.current = null;
                if (moved && moved.stageId !== stage.id) onMove(moved, stage.id);
              }}
              className={cn(
                "flex w-72 shrink-0 flex-col gap-3 rounded-xl border p-3 transition-colors",
                COLUMN_TONE[stage.type],
                over === stage.id && "ring-2 ring-ring",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <h2 className="truncate font-medium text-sm">{stage.name}</h2>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatNumber(total?.count ?? 0)} ·{" "}
                    <span className="font-mono">{formatMoney(total?.amount ?? 0, "USD", true)}</span>
                    {stage.probability !== null && stage.type === "open" ? ` · ${stage.probability}%` : ""}
                  </span>
                </div>
                {canCreate ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Create deal in ${stage.name}`}
                    onClick={() => onCreate(stage.id)}
                  >
                    <Plus />
                  </Button>
                ) : null}
              </div>
              {items.length ? (
                <ul className="-mx-1 flex max-h-[65vh] flex-col gap-2 overflow-y-auto px-1 pb-1">
                  {items.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      draggable={canUpdate}
                      onOpen={onOpen}
                      onDragStart={(deal) => {
                        dragging.current = deal;
                      }}
                    />
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed p-3 text-center text-muted-foreground text-xs">
                  {canUpdate ? "Drop deals here" : "No deals in this stage"}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
