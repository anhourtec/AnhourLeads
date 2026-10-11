"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { SearchX, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsLg } from "@/hooks/use-lg";
import {
  activeFilterCount,
  type FilterState,
  filtersFromObject,
  PER_PAGE_OPTIONS,
  type Segment,
} from "@/lib/search/filters";

import { AddToListDialog } from "../actions/add-to-list-dialog";
import { AddToSequenceDialog } from "../actions/add-to-sequence-dialog";
import { apiRequest } from "../api-client";
import { PersonaDialog } from "../persona-dialog";
import { SearchBox } from "../search-box";
import { BulkBar } from "./bulk-bar";
import { CompanyDrawer } from "./company-drawer";
import { NaturalLanguageBox, QuickFilters } from "./empty-state";
import { DEFAULT_PINS } from "./filter-catalog";
import type { EditorContext, FilterPatch } from "./filter-editors";
import { FilterRail } from "./filter-rail";
import { FiltersModal } from "./filters-modal";
import { columnsFor, defaultColumns, ResultsTable, type Row, type SelectMode } from "./results-table";
import { SavedSearchMenu, SaveSearchDialog } from "./saved-search-menu";
import { SearchPagination } from "./search-pagination";
import { type Density, ResearchMenu, SearchSettingsPopover, SortPopover, WorkflowMenu } from "./toolbar-menus";
import type {
  Facets,
  Pagination,
  QuickFilterData,
  SavedSearchItem,
  SearchContext,
  SearchOptions,
  SearchPermissions,
  SegmentCounts,
} from "./types";
import { useSearchState, useStoredState } from "./use-search-state";

export interface SearchShellProps {
  ctx: SearchContext;
  title: React.ReactNode;
  headerExtra?: React.ReactNode;
  headerActions?: React.ReactNode;
  rows: Row[];
  pagination: Pagination;
  counts: SegmentCounts;
  facets: Facets;
  quick: QuickFilterData;
  options: SearchOptions;
  savedSearches: SavedSearchItem[];
  activeSavedSearch: SavedSearchItem | null;
  permissions: SearchPermissions;
  /** Show results even with no filters (lists, saved records). */
  alwaysShowResults?: boolean;
  /** Replaces the default "no records" empty state (list page action cards). */
  emptyState?: React.ReactNode;
  /** Badges next to the page title (outside the heading). */
  titleAddon?: React.ReactNode;
  /** Shown above the title (list page breadcrumb). */
  breadcrumb?: React.ReactNode;
  /** Static list being viewed: adds "Remove from list" to the bulk bar. */
  staticListId?: string;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Apollo-style search screen shared by people, companies, saved records and list pages: toolbar,
 * filter rail (sheet below `lg`), filters modal, results table, bulk bar and company drawer.
 */
export function SearchShell(props: SearchShellProps) {
  const { ctx, rows, pagination, counts, facets, options, permissions } = props;
  const entity = ctx.entity;
  const router = useRouter();
  const isLg = useIsLg();
  const { filters, view, apply, replaceFilters, setView, pending } = useSearchState(ctx);
  const noun = entity === "contact" ? "people" : "companies";
  const apiBase = entity === "contact" ? "mixed_people" : "mixed_companies";

  const [pins, setPins] = useStoredState<string[]>(`anhour.search.pins.${entity}`, DEFAULT_PINS[entity]);
  const [railOpen, setRailOpen] = useStoredState<boolean>(`anhour.search.rail.${entity}`, true);
  const [storedColumns, setStoredColumns] = useStoredState<string[] | null>(`anhour.search.columns.${entity}`, null);
  const [density, setDensity] = useStoredState<Density>("anhour.search.density", "comfortable");
  const [perPagePref, setPerPagePref] = useStoredState<number>("anhour.search.perPage", 25);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [personaDraft, setPersonaDraft] = useState<{
    titles: string[];
    seniorities: string[];
    departments: string[];
  } | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [listIds, setListIds] = useState<string[] | null>(null);
  const [sequenceIds, setSequenceIds] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [allMatching, setAllMatching] = useState(false);

  const segment: Segment = ctx.fixedSegment ?? ((view.segment as Segment) || "total");
  const filterCount = activeFilterCount(filters);
  const hasQuery = Boolean(filters.q);
  const showResults =
    Boolean(props.alwaysShowResults) ||
    filterCount > 0 ||
    hasQuery ||
    Boolean(view.segment) ||
    Boolean(view.savedSearchId);

  // Results per page: the URL wins; otherwise apply the stored preference once.
  useEffect(() => {
    if (!view.per_page && perPagePref !== 25 && PER_PAGE_OPTIONS.includes(perPagePref as 25 | 50 | 100)) {
      setView({ per_page: String(perPagePref) }, true);
    }
  }, [perPagePref, view.per_page, setView]);

  // A new search clears the selection.
  const searchKey = JSON.stringify([filters, segment]);
  useEffect(() => {
    void searchKey;
    setSelected(new Set());
    setAllMatching(false);
  }, [searchKey]);

  const allColumns = useMemo(() => columnsFor(entity, options.customFields), [entity, options.customFields]);
  const columns = props.activeSavedSearch?.columns?.length
    ? props.activeSavedSearch.columns
    : (storedColumns ?? defaultColumns(entity));

  const onColumnsChange = (ids: string[]) => {
    setStoredColumns(ids);
    const active = props.activeSavedSearch;
    if (active?.isOwner) {
      void apiRequest(`/api/v1/saved_searches/${active.id}`, { method: "PATCH", body: { columns: ids } }).then(
        (res) => {
          if (!res.ok) toast.error(res.error);
          else router.refresh();
        },
      );
    }
  };

  const editorCtx: EditorContext = useMemo(
    () => ({
      entity,
      facets,
      options,
      permissions,
      onCreatePersona: permissions.personaManage ? (initial) => setPersonaDraft(initial) : undefined,
    }),
    [entity, facets, options, permissions],
  );

  const fixedBody = useMemo(
    () => ({ ...ctx.fixed, ...(segment !== "total" ? { segment } : {}) }),
    [ctx.fixed, segment],
  );
  const searchBody = useCallback(() => ({ ...filters, ...fixedBody }), [filters, fixedBody]);

  const selectedIds = [...selected];
  const selectedEmails = rows.flatMap((r) =>
    selected.has(r.id) && "email" in r && r.email && !r.suppressed ? [r.email] : [],
  );
  const filtersJson = encodeURIComponent(JSON.stringify(searchBody()));
  const workflowHref = `/dashboard/workflows/new?from=search&entity=${entity}&filters=${filtersJson}`;
  const assistantHref = `/dashboard/assistant?entity=${entity}&filters=${filtersJson}`;

  const clearAll = () => replaceFilters({});
  const applyPatch = (patch: FilterPatch) => apply(patch);

  async function selectApply(mode: SelectMode, n: number, maxPerCompany: number | null) {
    if (mode === "page") {
      setSelected(new Set(rows.map((r) => r.id)));
      setAllMatching(false);
      return;
    }
    const limit = mode === "all" ? 10_000 : n;
    const res = await apiRequest<{ ids: string[]; total: number }>(`/api/v1/${apiBase}/ids`, {
      body: { ...searchBody(), limit, ...(maxPerCompany ? { maxPerCompany } : {}) },
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSelected(new Set(res.data.ids));
    setAllMatching(mode === "all");
    toast.success(`Selected ${res.data.ids.length.toLocaleString("en-US")} ${noun}.`);
  }

  async function exportSelection() {
    const path = entity === "contact" ? "/api/v1/contacts/export" : "/api/v1/accounts/export";
    const body = allMatching ? searchBody() : { ids: selectedIds };
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(json.error ?? "The export failed. Try again.");
        return;
      }
      download(await res.blob(), `${noun}-${new Date().toISOString().slice(0, 10)}.csv`);
      toast.success(`Exported ${selectedIds.length.toLocaleString("en-US")} ${noun}.`);
    } catch {
      toast.error("Couldn't reach the server. Check your connection and try again.");
    }
  }

  async function researchSelection() {
    const ids = selectedIds.slice(0, 100);
    if (!ids.length) {
      toast.info("Select records first.");
      return;
    }
    toast.info(`Researching ${ids.length} ${noun}…`);
    let done = 0;
    let failed = 0;
    for (let i = 0; i < ids.length; i += 10) {
      const part = ids.slice(i, i + 10);
      const res =
        entity === "contact"
          ? await apiRequest<{ errors?: unknown[] }>("/api/v1/people/bulk_match", {
              body: { details: part.map((contactId) => ({ contactId })) },
            })
          : await apiRequest<{ errors?: unknown[] }>("/api/v1/organizations/bulk_enrich", {
              body: { details: part.map((companyId) => ({ companyId })) },
            });
      if (!res.ok) {
        toast.error(res.error);
        failed += part.length;
        break;
      }
      done += part.length - (res.data.errors?.length ?? 0);
      failed += res.data.errors?.length ?? 0;
    }
    toast.success(
      entity === "contact"
        ? `Looked up ${done} ${done === 1 ? "person" : "people"}${failed ? `; ${failed} couldn't be matched` : ""}.`
        : `Queued research for ${done} ${done === 1 ? "company" : "companies"}${failed ? `; ${failed} failed` : ""}.`,
    );
    if (selectedIds.length > 100) toast.info("Research runs on the first 100 selected records at a time.");
    router.refresh();
  }

  async function removeFromList(listId: string) {
    for (let i = 0; i < selectedIds.length; i += 1000) {
      const res = await apiRequest("/api/v1/labels/remove_entity_ids", {
        body: { listId, entityIds: selectedIds.slice(i, i + 1000) },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
    }
    toast.success(`Removed ${selectedIds.length.toLocaleString("en-US")} ${noun} from the list.`);
    setSelected(new Set());
    router.refresh();
  }

  const rail = (
    <FilterRail
      filters={filters}
      onChange={applyPatch}
      onClearAll={clearAll}
      ctx={editorCtx}
      pins={pins}
      counts={counts}
      segment={segment}
      onSegment={(s) => setView({ segment: s === "total" ? "total" : s })}
      lockedSegment={ctx.fixedSegment}
      onOpenModal={() => {
        setSheetOpen(false);
        setModalOpen(true);
      }}
    />
  );

  const selecting = selected.size > 0;
  const selectable =
    permissions.update ||
    permissions.delete ||
    permissions.listUpdate ||
    permissions.export ||
    permissions.sequenceLaunch;

  let results: React.ReactNode;
  if (!showResults) {
    results = (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
        <NaturalLanguageBox
          entity={entity}
          vocabulary={{
            locations: [...props.quick.locations.map((l) => l.value), ...(facets.country ?? []).map((c) => c.value)],
            industries: [...props.quick.industries.map((i) => i.value), ...(facets.industry ?? []).map((c) => c.value)],
          }}
          onApply={(f) => replaceFilters({ ...filters, ...f })}
        />
        <QuickFilters entity={entity} data={props.quick} onApply={applyPatch} />
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" onClick={() => setView({ segment: "total" })}>
            Show all {counts.total.toLocaleString("en-US")} {noun}
          </Button>
        </div>
      </div>
    );
  } else if (!rows.length) {
    results =
      filterCount || hasQuery ? (
        <Empty className="m-4 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No {noun} match these filters</EmptyTitle>
            <EmptyDescription>Try fewer filters or a shorter search.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" size="sm" onClick={clearAll}>
              Clear filters
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        (props.emptyState ?? (
          <Empty className="m-4 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No {noun} here yet</EmptyTitle>
              <EmptyDescription>Add or import records and they show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ))
      );
  } else {
    results = (
      <>
        <ResultsTable
          entity={entity}
          rows={rows}
          columns={columns}
          allColumns={allColumns}
          onColumnsChange={onColumnsChange}
          selected={selected}
          onSelectedChange={(next) => {
            setSelected(next);
            setAllMatching(false);
          }}
          onSelectApply={(m, n, cap) => void selectApply(m, n, cap)}
          selectable={selectable}
          density={density}
          permissions={permissions}
          total={pagination.total_entries}
          currentUserId={ctx.currentUserId}
          pending={pending}
          handlers={{
            onOpenCompany: setCompanyId,
            onAddToList: setListIds,
            onAddToSequence: setSequenceIds,
            onSaveCompany: (id) =>
              void apiRequest("/api/v1/accounts/update_owners", {
                body: { accountIds: [id], ownerId: ctx.currentUserId },
              }).then((res) => {
                if (!res.ok) toast.error(res.error);
                else {
                  toast.success("Saved to you.");
                  router.refresh();
                }
              }),
          }}
        />
        <SearchPagination pagination={pagination} noun={noun} onPage={(p) => setView({ page: String(p) }, true)} />
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {props.breadcrumb}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words font-medium text-2xl tracking-tight">{props.title}</h1>
            {props.titleAddon}
          </div>
          {props.headerExtra}
        </div>
        {props.headerActions ? <div className="flex flex-wrap items-center gap-2">{props.headerActions}</div> : null}
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <SavedSearchMenu
            searches={props.savedSearches}
            active={props.activeSavedSearch}
            currentUserId={ctx.currentUserId}
            canSave={permissions.saveSearch}
            onSelect={(s) =>
              replaceFilters(filtersFromObject(s.filters), {
                savedSearchId: s.id,
                sortBy: s.sort?.field ?? null,
                sortAscending: s.sort ? String(s.sort.ascending) : null,
              })
            }
            onDefault={() =>
              replaceFilters({}, { savedSearchId: null, sortBy: null, sortAscending: null, segment: null })
            }
            onCreate={() => setSaveOpen(true)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={isLg ? railOpen : sheetOpen}
            onClick={() => (isLg ? setRailOpen(!railOpen) : setSheetOpen(true))}
          >
            <SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
            {isLg ? (railOpen ? "Hide filters" : "Show filters") : "Filters"}
            {filterCount ? (
              <Badge variant="secondary" className="font-mono tabular-nums">
                {filterCount}
              </Badge>
            ) : null}
          </Button>
          <SearchBox placeholder={`Search ${noun}`} label={`Search ${noun}`} />
        </div>
        {selecting ? (
          <div className="flex min-w-0 lg:justify-end">
            <BulkBar
              entity={entity}
              ids={selectedIds}
              emails={selectedEmails}
              permissions={permissions}
              members={options.members}
              currentUserId={ctx.currentUserId}
              workflowHref={workflowHref}
              onClear={() => {
                setSelected(new Set());
                setAllMatching(false);
              }}
              onAddToList={() => setListIds(selectedIds)}
              onAddToSequence={() => setSequenceIds(selectedIds)}
              onExport={() => void exportSelection()}
              onResearch={() => void researchSelection()}
              onRemoveFromList={
                props.staticListId && permissions.listUpdate
                  ? () => void removeFromList(props.staticListId ?? "")
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 lg:justify-end">
            <ResearchMenu
              entity={entity}
              selectedCount={0}
              canEnrich={permissions.enrich}
              canAsk={permissions.aiUse}
              assistantHref={assistantHref}
              onEnrichSelected={() => void researchSelection()}
            />
            <WorkflowMenu canCreate={permissions.workflowCreate} fromSearchHref={workflowHref} />
            {permissions.saveSearch ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setSaveOpen(true)}>
                Save as new search
              </Button>
            ) : null}
            <SortPopover
              entity={entity}
              sortBy={view.sortBy}
              ascending={view.sortAscending === "true"}
              onApply={(sortBy, asc) => setView({ sortBy, sortAscending: sortBy ? String(asc) : null })}
            />
            <SearchSettingsPopover
              density={density}
              onDensity={setDensity}
              perPage={pagination.per_page}
              onPerPage={(n) => {
                setPerPagePref(n);
                setView({ per_page: String(n) });
              }}
            />
          </div>
        )}
      </div>

      <div
        className={
          isLg && railOpen
            ? "grid min-w-0 gap-3 lg:grid-cols-[18rem_minmax(0,1fr)]"
            : "grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)]"
        }
      >
        {railOpen ? (
          <aside
            aria-label="Filters"
            className="hidden max-h-[calc(100vh-7rem)] min-h-96 flex-col overflow-hidden rounded-xl border bg-card lg:sticky lg:top-16 lg:flex"
          >
            {isLg ? rail : null}
          </aside>
        ) : null}
        <section aria-label="Results" className="min-w-0 rounded-xl border bg-card" aria-busy={pending}>
          {results}
        </section>
      </div>

      {!isLg ? (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent side="left" className="w-[min(22rem,100vw)] gap-0 p-0">
            <SheetHeader className="border-b">
              <SheetTitle>Filters</SheetTitle>
              <SheetDescription className="sr-only">Narrow down the {noun} shown.</SheetDescription>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col">{rail}</div>
          </SheetContent>
        </Sheet>
      ) : null}

      <FiltersModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        filters={filters}
        ctx={editorCtx}
        pins={pins}
        onPinsChange={setPins}
        onApply={(next: FilterState) => replaceFilters(next)}
        countUrl={`/api/v1/${apiBase}/search`}
        fixedBody={fixedBody}
      />

      {permissions.saveSearch ? (
        <SaveSearchDialog
          open={saveOpen}
          onOpenChange={setSaveOpen}
          entityType={entity}
          filters={{ ...filters, ...(segment !== "total" && !ctx.fixedSegment ? { segment } : {}) }}
          columns={columns}
          sort={view.sortBy ? { field: view.sortBy, ascending: view.sortAscending === "true" } : null}
          members={options.members}
          existing={props.activeSavedSearch}
          onSaved={(id) => setView({ savedSearchId: id }, true)}
        />
      ) : null}

      {permissions.listUpdate ? (
        <AddToListDialog
          open={listIds !== null}
          onOpenChange={(o) => !o && setListIds(null)}
          entityType={entity}
          ids={listIds ?? []}
          canCreate={permissions.listCreate}
        />
      ) : null}
      {permissions.sequenceLaunch && entity === "contact" ? (
        <AddToSequenceDialog
          open={sequenceIds !== null}
          onOpenChange={(o) => !o && setSequenceIds(null)}
          contactIds={sequenceIds ?? []}
        />
      ) : null}
      {permissions.personaManage ? (
        <PersonaDialog
          open={personaDraft !== null}
          onOpenChange={(o) => !o && setPersonaDraft(null)}
          initial={personaDraft ?? undefined}
          onSaved={(p) => {
            setPersonaDraft(null);
            apply({ personaId: [p.id] });
          }}
        />
      ) : null}
      <CompanyDrawer
        companyId={companyId}
        onClose={() => setCompanyId(null)}
        permissions={{
          update: entity === "company" ? permissions.update : permissions.companyUpdate,
          listUpdate: permissions.listUpdate,
          listCreate: permissions.listCreate,
        }}
        currentUserId={ctx.currentUserId}
      />
    </div>
  );
}
