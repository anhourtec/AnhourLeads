"use client";

import { useState } from "react";

import { type ColumnDef, type RowSelectionState, useTable } from "@tanstack/react-table";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type DataTableFeatures, dataTableFeatures } from "@/lib/data-table-features";

import { type FilterField, RecordFiltersAside, RecordFiltersSheet } from "./record-filters";
import { type PaginationInfo, RecordsPagination } from "./records-pagination";
import { SearchBox } from "./search-box";
import { useUrlParams } from "./use-url-params";

/**
 * List screen shell shared by people and companies: filter column (sheet below `lg`), search,
 * server-paginated table with row selection, bulk actions slot, and empty states.
 */
export function RecordsTableView<T extends { id: string }>({
  rows,
  columns,
  selectable,
  pagination,
  noun,
  fields,
  filterParams,
  search,
  bulkActions,
  empty,
}: {
  rows: T[];
  columns: ColumnDef<DataTableFeatures, T>[];
  selectable: boolean;
  pagination: PaginationInfo;
  noun: string;
  fields: FilterField[];
  filterParams: string[];
  search: { placeholder: string; label: string };
  bulkActions: (ids: string[], clear: () => void) => React.ReactNode;
  empty: { icon: React.ReactNode; title: string; description: string; actions?: React.ReactNode };
}) {
  const { searchParams, setParams, pending } = useUrlParams();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const table = useTable({
    features: dataTableFeatures,
    data: rows,
    columns,
    state: { rowSelection },
    getRowId: (row) => row.id,
    enableRowSelection: selectable,
    onRowSelectionChange: setRowSelection,
    manualPagination: true,
    rowCount: pagination.total_entries,
  });

  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id] && rows.some((r) => r.id === id));
  const filtered = filterParams.some((p) => searchParams.getAll(p).some(Boolean));

  let content: React.ReactNode;
  if (rows.length) {
    content = (
      <Table className="**:data-[slot=table-cell]:px-4 **:data-[slot=table-head]:px-4">
        <TableHeader className="[&_tr]:border-t">
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={header.column.id === "select" ? "w-10 font-normal" : "font-normal text-muted-foreground"}
                >
                  {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody className={pending ? "opacity-60 transition-opacity" : undefined}>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id} data-state={rowSelection[row.id] ? "selected" : undefined}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id} className="py-2.5 align-top">
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  } else if (filtered) {
    content = (
      <Empty className="mx-4 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No {noun} match these filters</EmptyTitle>
          <EmptyDescription>Try fewer filters or a shorter search.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setParams(Object.fromEntries(filterParams.map((p) => [p, null])))}
          >
            Clear filters
          </Button>
        </EmptyContent>
      </Empty>
    );
  } else {
    content = (
      <Empty className="mx-4 border">
        <EmptyHeader>
          <EmptyMedia variant="icon">{empty.icon}</EmptyMedia>
          <EmptyTitle>{empty.title}</EmptyTitle>
          <EmptyDescription>{empty.description}</EmptyDescription>
        </EmptyHeader>
        {empty.actions ? (
          <EmptyContent className="flex-row flex-wrap justify-center">{empty.actions}</EmptyContent>
        ) : null}
      </Empty>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-6">
      <RecordFiltersAside fields={fields} />
      <Card className="min-w-0 gap-4 py-4">
        <div className="flex flex-col gap-3 px-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox placeholder={search.placeholder} label={search.label} />
            <RecordFiltersSheet fields={fields} />
          </div>
          {selectedIds.length ? bulkActions(selectedIds, () => setRowSelection({})) : null}
        </div>
        <CardContent className="px-0" aria-busy={pending}>
          {content}
        </CardContent>
        {rows.length ? <RecordsPagination pagination={pagination} noun={noun} /> : null}
      </Card>
    </div>
  );
}
