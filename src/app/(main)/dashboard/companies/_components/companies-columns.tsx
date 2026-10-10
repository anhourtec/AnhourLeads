"use client";

import Link from "next/link";

import { type ColumnDef, Subscribe } from "@tanstack/react-table";

import { Checkbox } from "@/components/ui/checkbox";
import type { DataTableFeatures } from "@/lib/data-table-features";

import { CompanyStagePill, SuppressedPill } from "../../_components/records/status-pills";
import type { CompanyRow } from "./types";

const selectColumn: ColumnDef<DataTableFeatures, CompanyRow> = {
  id: "select",
  header: ({ table }) => (
    <Subscribe
      source={table.atoms.rowSelection}
      selector={() => table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() ? "indeterminate" : false)}
    >
      {(checked) => (
        <Checkbox
          aria-label="Select all companies on this page"
          checked={checked}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        />
      )}
    </Subscribe>
  ),
  cell: ({ row }) => (
    <Subscribe source={row.table.atoms.rowSelection} selector={(selection) => Boolean(selection?.[row.id])}>
      {(checked) => (
        <Checkbox
          aria-label={`Select ${row.original.name}`}
          checked={checked}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
        />
      )}
    </Subscribe>
  ),
  enableSorting: false,
  enableHiding: false,
};

const muted = (text = "—") => <span className="text-muted-foreground">{text}</span>;

const dataColumns: ColumnDef<DataTableFeatures, CompanyRow>[] = [
  {
    id: "name",
    header: "Company",
    cell: ({ row }) => (
      <div className="flex min-w-40 flex-col items-start gap-0.5">
        <Link
          href={`/dashboard/companies/${row.original.id}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
        {row.original.domain ? (
          <span className="font-mono text-muted-foreground text-xs">{row.original.domain}</span>
        ) : null}
        {row.original.suppressed ? <SuppressedPill /> : null}
      </div>
    ),
  },
  {
    id: "industry",
    header: "Industry",
    cell: ({ row }) => <span className="whitespace-nowrap">{row.original.industry ?? muted()}</span>,
  },
  {
    id: "employees",
    header: () => <span className="block text-right">Employees</span>,
    cell: ({ row }) => (
      <span className="block text-right font-mono tabular-nums">
        {row.original.employeeCount === null ? muted() : row.original.employeeCount.toLocaleString("en-US")}
      </span>
    ),
  },
  {
    id: "location",
    header: "Location",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        {[row.original.city, row.original.country].filter(Boolean).join(", ") || muted()}
      </span>
    ),
  },
  {
    id: "people",
    header: () => <span className="block text-right">People</span>,
    cell: ({ row }) => (
      <span className="block text-right font-mono tabular-nums">
        {row.original.contactCount.toLocaleString("en-US")}
      </span>
    ),
  },
  {
    id: "stage",
    header: "Stage",
    cell: ({ row }) => <CompanyStagePill stage={row.original.stage} />,
  },
  {
    id: "owner",
    header: "Owner",
    cell: ({ row }) => <span className="whitespace-nowrap">{row.original.owner?.name ?? muted("Unassigned")}</span>,
  },
];

export function companiesColumns(selectable: boolean): ColumnDef<DataTableFeatures, CompanyRow>[] {
  return selectable ? [selectColumn, ...dataColumns] : dataColumns;
}
