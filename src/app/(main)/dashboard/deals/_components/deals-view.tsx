"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import {
  ArrowRightLeft,
  EllipsisVertical,
  Handshake,
  Kanban,
  Pencil,
  Plus,
  Search,
  Table2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiFetch } from "@/lib/api-fetch";
import { formatDate, formatMoney, formatNumber } from "@/lib/format-display";
import { DEAL_STAGE_INFO, DEAL_STAGES, type DealStage } from "@/lib/pipeline-constants";
import { can, type Role } from "@/lib/rbac/permissions";
import type { DealDto, StageTotal } from "@/server/services/deals";

import { ConfirmDialog } from "../../_components/pipeline/confirm-dialog";
import { PageHeader } from "../../_components/pipeline/page-header";
import { StagePill } from "../../_components/pipeline/pills";
import { useUrlFilters } from "../../_components/pipeline/use-url-filters";
import { DealDialog, type MemberOption } from "./deal-dialog";

interface DealActionsProps {
  deal: DealDto;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (deal: DealDto) => void;
  onMove: (deal: DealDto, stage: DealStage) => void;
  onDelete: (deal: DealDto) => void;
}

function DealActions({ deal, canUpdate, canDelete, onEdit, onMove, onDelete }: DealActionsProps) {
  if (!canUpdate && !canDelete) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${deal.name}`}>
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {canUpdate ? (
          <>
            <DropdownMenuItem onSelect={() => onEdit(deal)}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-muted-foreground text-xs">Move to</DropdownMenuLabel>
            {DEAL_STAGES.filter((s) => s !== deal.stage).map((stage) => (
              <DropdownMenuItem key={stage} onSelect={() => onMove(deal, stage)}>
                <ArrowRightLeft />
                {DEAL_STAGE_INFO[stage].name}
              </DropdownMenuItem>
            ))}
          </>
        ) : null}
        {canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onDelete(deal)}>
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DealCard({ deal, actions }: { deal: DealDto; actions: Omit<DealActionsProps, "deal"> }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words font-medium text-sm">{deal.name}</span>
        <DealActions deal={deal} {...actions} />
      </div>
      {deal.company || deal.contact ? (
        <span className="truncate text-muted-foreground text-xs">
          {[deal.company?.name, deal.contact?.name].filter(Boolean).join(" · ")}
        </span>
      ) : null}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium font-mono tabular-nums">{formatMoney(deal.amount, deal.currency)}</span>
        <span className="truncate text-muted-foreground">
          {deal.closeDate ? `Closes ${formatDate(deal.closeDate)}` : (deal.owner?.name ?? "")}
        </span>
      </div>
    </li>
  );
}

export function DealsView({
  deals,
  totals,
  total,
  limit,
  members,
  currentUserId,
  role,
  view,
}: {
  readonly deals: DealDto[];
  readonly totals: StageTotal[];
  readonly total: number;
  readonly limit: number;
  readonly members: MemberOption[];
  readonly currentUserId: string;
  readonly role: Role;
  readonly view: "board" | "table";
}) {
  const router = useRouter();
  const filters = useUrlFilters();
  const [query, setQuery] = useState(filters.get("q"));
  const [dialog, setDialog] = useState<{ open: boolean; deal: DealDto | null; stage: DealStage }>({
    open: false,
    deal: null,
    stage: "qualify",
  });
  const [toDelete, setToDelete] = useState<DealDto | null>(null);
  const canCreate = can(role, "deal:create");
  const canUpdate = can(role, "deal:update");
  const canDelete = can(role, "deal:delete");
  const hasFilters = Boolean(filters.get("q") || filters.get("owner"));
  const openValue = totals.filter((t) => !DEAL_STAGE_INFO[t.stage].isClosed).reduce((s, t) => s + t.amount, 0);

  async function move(deal: DealDto, stage: DealStage) {
    const res = await apiFetch(`/api/v1/opportunities/${deal.id}`, { method: "PATCH", body: { stage } });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Moved to ${DEAL_STAGE_INFO[stage].name.toLowerCase()}`);
    router.refresh();
  }

  async function remove(): Promise<boolean> {
    if (!toDelete) return true;
    const res = await apiFetch(`/api/v1/opportunities/${toDelete.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success("Deal deleted");
    router.refresh();
    return true;
  }

  const actions = {
    canUpdate,
    canDelete,
    onEdit: (deal: DealDto) => setDialog({ open: true, deal, stage: deal.stage }),
    onMove: (deal: DealDto, stage: DealStage) => void move(deal, stage),
    onDelete: (deal: DealDto) => setToDelete(deal),
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 md:gap-6">
      <PageHeader
        title="Deals"
        description={
          <>
            <span className="font-mono tabular-nums">{formatMoney(openValue)}</span> in open pipeline across{" "}
            <span className="font-mono tabular-nums">{formatNumber(total)}</span> {total === 1 ? "deal" : "deals"}.
          </>
        }
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setDialog({ open: true, deal: null, stage: "qualify" })}>
              <Plus data-icon="inline-start" />
              New deal
            </Button>
          ) : null
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <form
            className="w-full sm:w-64"
            onSubmit={(e) => {
              e.preventDefault();
              filters.set({ q: query.trim() || null });
            }}
          >
            <InputGroup>
              <InputGroupAddon>
                <Search aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search deals"
                placeholder="Search deals"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </InputGroup>
          </form>
          <NativeSelect
            size="sm"
            aria-label="Owner"
            value={filters.get("owner")}
            onChange={(e) => filters.set({ owner: e.target.value })}
            className="w-full sm:w-44"
          >
            <NativeSelectOption value="">Everyone's deals</NativeSelectOption>
            <NativeSelectOption value="me">My deals</NativeSelectOption>
          </NativeSelect>
        </div>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={view}
          onValueChange={(v) => v && filters.set({ view: v === "table" ? "table" : null })}
          aria-label="Layout"
        >
          <ToggleGroupItem value="board" aria-label="Board">
            <Kanban data-icon="inline-start" />
            Board
          </ToggleGroupItem>
          <ToggleGroupItem value="table" aria-label="Table">
            <Table2 data-icon="inline-start" />
            Table
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {total === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Handshake aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{hasFilters ? "No deals match" : "No deals yet"}</EmptyTitle>
            <EmptyDescription>
              {hasFilters ? "Try a different search." : "Add a deal to start tracking your pipeline by stage."}
            </EmptyDescription>
          </EmptyHeader>
          {canCreate && !hasFilters ? (
            <EmptyContent>
              <Button size="sm" onClick={() => setDialog({ open: true, deal: null, stage: "qualify" })}>
                <Plus data-icon="inline-start" />
                New deal
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : null}

      {total > 0 && view === "board" ? (
        <section aria-label="Deals by stage" className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
          <div className="flex w-max gap-3">
            {DEAL_STAGES.map((stage) => {
              const stageTotal = totals.find((t) => t.stage === stage);
              const items = deals.filter((d) => d.stage === stage);
              return (
                <div
                  key={stage}
                  className="flex w-72 shrink-0 flex-col gap-3 rounded-xl border bg-muted/40 p-3"
                  data-testid={`stage-${stage}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-0.5">
                      <h2 className="font-medium text-sm">{DEAL_STAGE_INFO[stage].name}</h2>
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {formatNumber(stageTotal?.count ?? 0)} ·{" "}
                        <span className="font-mono">{formatMoney(stageTotal?.amount ?? 0, "USD", true)}</span>
                      </span>
                    </div>
                    {canCreate ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`New deal in ${DEAL_STAGE_INFO[stage].name}`}
                        onClick={() => setDialog({ open: true, deal: null, stage })}
                      >
                        <Plus />
                      </Button>
                    ) : null}
                  </div>
                  {items.length ? (
                    <ul className="flex flex-col gap-2">
                      {items.map((deal) => (
                        <DealCard key={deal.id} deal={deal} actions={actions} />
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-dashed p-3 text-center text-muted-foreground text-xs">
                      No deals in this stage
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {total > 0 && view === "table" ? (
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Deal</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Close date</TableHead>
                <TableHead className="pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals.map((deal) => (
                <TableRow key={deal.id}>
                  <TableCell className="max-w-72 pl-4">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-medium">{deal.name}</span>
                      {deal.company || deal.contact ? (
                        <span className="truncate text-muted-foreground text-xs">
                          {[deal.company?.name, deal.contact?.name].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StagePill stage={deal.stage} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(deal.amount, deal.currency)}
                  </TableCell>
                  <TableCell className="max-w-40 truncate">
                    {deal.owner?.id === currentUserId ? "You" : (deal.owner?.name ?? "No owner")}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDate(deal.closeDate)}</TableCell>
                  <TableCell className="pr-4 text-right">
                    <DealActions deal={deal} {...actions} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <tfoot className="border-t bg-muted/40 text-xs">
              <tr>
                <td colSpan={6} className="px-4 py-2 text-muted-foreground">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {totals.map((t) => (
                      <span key={t.stage} className="tabular-nums">
                        {t.name}:{" "}
                        <span className="font-mono text-foreground">{formatMoney(t.amount, "USD", true)}</span> (
                        {t.count})
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            </tfoot>
          </Table>
        </div>
      ) : null}

      {total > limit ? (
        <p className="text-muted-foreground text-xs">
          Showing the {formatNumber(limit)} most recent deals. Totals include all {formatNumber(total)}. Search to
          narrow the list.
        </p>
      ) : null}

      <DealDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        deal={dialog.deal}
        members={members}
        defaultOwnerId={currentUserId}
        defaultStage={dialog.stage}
      />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
        title="Delete this deal?"
        description={`"${toDelete?.name ?? ""}" will be removed from the pipeline. This can't be undone.`}
        confirmLabel="Delete deal"
        pendingLabel="Deleting…"
        icon={<Trash2 data-icon="inline-start" />}
        onConfirm={remove}
      />
    </div>
  );
}
