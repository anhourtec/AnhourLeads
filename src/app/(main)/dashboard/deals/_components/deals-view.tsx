"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  ArrowDownUp,
  ChevronDown,
  Filter,
  Handshake,
  Kanban,
  Layers,
  Plus,
  Search,
  Settings2,
  Table2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { apiFetch } from "@/lib/api-fetch";
import { formatMoney, formatNumber } from "@/lib/format-display";
import { can, type Role } from "@/lib/rbac/permissions";
import type { DealDto, PipelineStageTotal } from "@/server/services/deals";
import type { PipelineDto } from "@/server/services/pipelines";

import { PageHeader } from "../../_components/pipeline/page-header";
import { useUrlFilters } from "../../_components/pipeline/use-url-filters";
import { DealDrawer } from "./deal-drawer";
import { type DealCustomField, DealFormDialog, type DealPrefill, type MemberOption } from "./deal-form-dialog";
import { activeFilterCount, type DealParams, type DealSort } from "./deal-params";
import { DealsBoard } from "./deals-board";
import { DealsFilters } from "./deals-filters";
import { DealsIntroDialog } from "./deals-intro-dialog";
import { DealsTable } from "./deals-table";
import { ImportDealsDialog } from "./import-deals-dialog";

const SORT_LABELS: Record<DealSort, string> = {
  created_at: "Created date",
  close_date: "Close date",
  amount: "Amount",
};

interface SearchResult {
  deals: DealDto[];
  total: number;
  pipelineTotals: PipelineStageTotal[];
}

export function DealsView({
  params,
  pipelines,
  pipelineId,
  result,
  limit,
  members,
  customFields,
  currentUserId,
  role,
  analytics,
  prefill = null,
}: {
  readonly params: DealParams;
  readonly pipelines: PipelineDto[];
  readonly pipelineId: string | null;
  readonly result: SearchResult | null;
  readonly limit: number;
  readonly members: MemberOption[];
  readonly customFields: DealCustomField[];
  readonly currentUserId: string;
  readonly role: Role;
  readonly analytics: ReactNode;
  readonly prefill?: DealPrefill | null;
}) {
  const router = useRouter();
  const filters = useUrlFilters();
  const [query, setQuery] = useState(params.q);
  const [deals, setDeals] = useState<DealDto[]>(result?.deals ?? []);
  const [totals, setTotals] = useState<PipelineStageTotal[]>(result?.pipelineTotals ?? []);
  const [form, setForm] = useState<{
    open: boolean;
    deal: DealDto | null;
    stageId?: string;
    nonce: number;
    prefill?: DealPrefill | null;
  }>({
    prefill,
    open: params.create && can(role, "deal:create"),
    deal: null,
    nonce: 0,
  });
  const [openDealId, setOpenDealId] = useState<string | null>(params.deal || null);
  const [showFilters, setShowFilters] = useState(params.filters || activeFilterCount(params) > 0);

  useEffect(() => {
    setDeals(result?.deals ?? []);
    setTotals(result?.pipelineTotals ?? []);
  }, [result]);

  const canCreate = can(role, "deal:create");
  const canUpdate = can(role, "deal:update");
  const pipeline = pipelines.find((p) => p.id === pipelineId) ?? null;
  const defaultPipeline = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const openDeal = useMemo(() => deals.find((d) => d.id === openDealId) ?? null, [deals, openDealId]);
  const total = result?.total ?? 0;
  const filterCount = activeFilterCount(params);
  const hasFilters = Boolean(params.q) || filterCount > 0;
  const openValue = totals
    .filter((t) => pipeline?.stages.find((s) => s.id === t.stageId)?.type === "open")
    .reduce((s, t) => s + t.amount, 0);

  async function move(deal: DealDto, stageId: string) {
    if (deal.stageId === stageId) return;
    const target = pipelines.flatMap((p) => p.stages).find((s) => s.id === stageId);
    const before = { deals, totals };
    // Show the move at once; roll back if the server refuses it.
    setDeals((list) =>
      list.map((d) =>
        d.id === deal.id && target
          ? {
              ...d,
              stageId,
              stageName: target.name,
              stageType: target.type,
              isClosed: target.type !== "open",
              isWon: target.type === "won",
            }
          : d,
      ),
    );
    setTotals((list) => {
      const amount = deal.amount ?? 0;
      const next = list.map((t) => {
        if (t.stageId === deal.stageId) return { ...t, count: t.count - 1, amount: t.amount - amount };
        if (t.stageId === stageId) return { ...t, count: t.count + 1, amount: t.amount + amount };
        return t;
      });
      return next.some((t) => t.stageId === stageId) ? next : [...next, { stageId, count: 1, amount }];
    });
    const res = await apiFetch(`/api/v1/opportunities/${deal.id}`, { method: "PATCH", body: { stageId } });
    if (!res.ok) {
      setDeals(before.deals);
      setTotals(before.totals);
      toast.error(res.error);
      return;
    }
    toast.success(`Moved to ${target?.name ?? "the new stage"}`);
    router.refresh();
  }

  const openCreate = (stageId?: string) =>
    setForm((f) => ({ open: true, deal: null, stageId, nonce: f.nonce + 1, prefill: null }));

  const pipelineLabel = pipeline?.name ?? "All pipelines";

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Deals"
        actions={
          canCreate ? (
            <>
              <ImportDealsDialog pipelines={pipelines} defaultPipelineId={pipeline?.id ?? defaultPipeline.id} />
              <Button size="sm" onClick={() => openCreate()}>
                <Plus data-icon="inline-start" />
                Create deal
              </Button>
            </>
          ) : null
        }
      />

      <Tabs value={params.tab} onValueChange={(v) => filters.set({ tab: v === "analytics" ? "analytics" : null })}>
        <TabsList
          variant="line"
          className="w-full justify-start overflow-x-auto border-b *:data-[slot=tabs-trigger]:flex-none"
        >
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="analytics">
            Analytics
            <Badge variant="secondary" className="ml-1 bg-sky-500/10 text-sky-700 dark:text-sky-400">
              New
            </Badge>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label={`Pipeline: ${pipelineLabel}`}>
                <Layers data-icon="inline-start" />
                <span className="max-w-40 truncate">{pipelineLabel}</span>
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              <DropdownMenuLabel className="text-muted-foreground text-xs">Pipelines</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={pipeline?.id ?? "all"}
                onValueChange={(v) => {
                  if (v === "all") filters.set({ pipeline: "all", viewMode: "table", stage: null });
                  else filters.set({ pipeline: v, stage: null });
                }}
              >
                <DropdownMenuRadioItem value="all">All pipelines</DropdownMenuRadioItem>
                {pipelines.map((p) => (
                  <DropdownMenuRadioItem key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault ? <span className="ml-auto text-muted-foreground text-xs">Default</span> : null}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {can(role, "pipeline:manage") ? (
                <>
                  <DropdownMenuSeparator />
                  <Link
                    href="/dashboard/settings/pipelines"
                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent focus-visible:bg-accent"
                  >
                    <Settings2 className="size-4" aria-hidden="true" />
                    Manage pipelines
                  </Link>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          {params.tab === "overview" ? (
            <>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={params.view}
                onValueChange={(v) => {
                  if (!v) return;
                  filters.set(
                    v === "table"
                      ? { viewMode: "table" }
                      : { viewMode: null, pipeline: params.pipeline === "all" ? null : params.pipeline || null },
                  );
                }}
                aria-label="View"
              >
                <ToggleGroupItem value="kanban" aria-label="Board">
                  <Kanban />
                </ToggleGroupItem>
                <ToggleGroupItem value="table" aria-label="Table">
                  <Table2 />
                </ToggleGroupItem>
              </ToggleGroup>
              <Button
                variant={showFilters ? "secondary" : "outline"}
                size="sm"
                aria-expanded={showFilters}
                onClick={() => setShowFilters((v) => !v)}
              >
                <Filter data-icon="inline-start" />
                {showFilters ? "Hide filters" : "Show filters"}
                {filterCount ? <span className="font-mono text-xs">({filterCount})</span> : null}
              </Button>
            </>
          ) : null}
        </div>
        {params.tab === "overview" ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <form
              className="w-full sm:w-56"
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
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label={`Sort: ${SORT_LABELS[params.sort]}`}>
                  <ArrowDownUp data-icon="inline-start" />
                  {SORT_LABELS[params.sort]}
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={params.sort}
                  onValueChange={(v) => filters.set({ sort: v === "created_at" ? null : v })}
                >
                  {(Object.keys(SORT_LABELS) as DealSort[]).map((s) => (
                    <DropdownMenuRadioItem key={s} value={s}>
                      {SORT_LABELS[s]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>

      {params.tab === "overview" && showFilters ? (
        <DealsFilters
          key={JSON.stringify([params.owners, params.stages, params.closeFrom, params.closeTo, params.company])}
          params={params}
          pipeline={pipeline}
          members={members}
          onApply={(changes) => filters.set({ ...changes, filters: "1" })}
        />
      ) : null}

      {params.tab === "analytics" ? analytics : null}

      {params.tab === "overview" ? (
        <>
          <p className="text-muted-foreground text-sm">
            <span className="font-mono text-foreground tabular-nums">{formatNumber(total)}</span>{" "}
            {total === 1 ? "deal" : "deals"}
            {pipeline ? (
              <>
                {" "}
                · <span className="font-mono text-foreground tabular-nums">{formatMoney(openValue)}</span> open in{" "}
                {pipeline.name}
              </>
            ) : null}
          </p>

          {total === 0 && !hasFilters && params.view === "table" ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Handshake aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle>Start winning more deals</EmptyTitle>
                <EmptyDescription>
                  Create your first deal to track its stage, value, people and activity in one place.
                </EmptyDescription>
              </EmptyHeader>
              {canCreate ? (
                <EmptyContent>
                  <Button size="sm" onClick={() => openCreate()}>
                    <Plus data-icon="inline-start" />
                    Create deal
                  </Button>
                </EmptyContent>
              ) : null}
            </Empty>
          ) : null}

          {total === 0 && hasFilters && params.view === "table" ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>No deals match</EmptyTitle>
                <EmptyDescription>Try other filters or clear the search.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : null}

          {params.view === "kanban" && pipeline ? (
            <DealsBoard
              pipeline={pipeline}
              deals={deals}
              totals={totals}
              canUpdate={canUpdate}
              canCreate={canCreate}
              onMove={(deal, stageId) => void move(deal, stageId)}
              onOpen={(deal) => setOpenDealId(deal.id)}
              onCreate={(stageId) => openCreate(stageId)}
            />
          ) : null}

          {params.view === "table" && total > 0 ? (
            <DealsTable
              deals={deals}
              currentUserId={currentUserId}
              showPipeline={!pipeline}
              onOpen={(deal) => setOpenDealId(deal.id)}
            />
          ) : null}

          {total > limit ? (
            <p className="text-muted-foreground text-xs">
              Showing the {formatNumber(limit)} most recent deals. Totals include all {formatNumber(total)}. Filter to
              narrow the list.
            </p>
          ) : null}
        </>
      ) : null}

      <DealFormDialog
        key={`${form.deal?.id ?? "new"}-${form.nonce}`}
        open={form.open}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        deal={form.deal}
        pipelines={pipelines}
        defaultPipelineId={pipeline?.id ?? defaultPipeline.id}
        defaultStageId={form.stageId}
        members={members}
        customFields={customFields}
        currentUserId={currentUserId}
        canCreateCompany={can(role, "company:create")}
        prefill={form.prefill}
      />
      <DealDrawer
        deal={openDeal}
        pipelines={pipelines}
        canUpdate={canUpdate}
        canDelete={can(role, "deal:delete")}
        canNote={can(role, "note:create")}
        onClose={() => setOpenDealId(null)}
        onEdit={(deal) => {
          setOpenDealId(null);
          setForm((f) => ({ open: true, deal, nonce: f.nonce + 1 }));
        }}
        onMove={(deal, stageId) => void move(deal, stageId)}
      />
      {params.create ? null : <DealsIntroDialog userId={currentUserId} />}
    </div>
  );
}
