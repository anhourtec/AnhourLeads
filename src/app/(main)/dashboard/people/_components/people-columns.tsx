"use client";

import Link from "next/link";

import { type ColumnDef, Subscribe } from "@tanstack/react-table";

import { Checkbox } from "@/components/ui/checkbox";
import type { DataTableFeatures } from "@/lib/data-table-features";

import { ContactStagePill, EmailStatusPill, SuppressedPill } from "../../_components/records/status-pills";
import type { PersonRow } from "./types";

const selectColumn: ColumnDef<DataTableFeatures, PersonRow> = {
  id: "select",
  header: ({ table }) => (
    <Subscribe
      source={table.atoms.rowSelection}
      selector={() => table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() ? "indeterminate" : false)}
    >
      {(checked) => (
        <Checkbox
          aria-label="Select all people on this page"
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

const dataColumns: ColumnDef<DataTableFeatures, PersonRow>[] = [
  {
    id: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="flex min-w-40 flex-col">
        <Link
          href={`/dashboard/people/${row.original.id}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
        {row.original.city || row.original.country ? (
          <span className="text-muted-foreground text-xs">
            {[row.original.city, row.original.country].filter(Boolean).join(", ")}
          </span>
        ) : null}
      </div>
    ),
  },
  {
    id: "title",
    header: "Title",
    cell: ({ row }) => (
      <span className="line-clamp-2 min-w-36 max-w-56">
        {row.original.title ?? <span className="text-muted-foreground">—</span>}
      </span>
    ),
  },
  {
    id: "company",
    header: "Company",
    cell: ({ row }) =>
      row.original.company ? (
        <Link
          href={`/dashboard/companies/${row.original.company.id}`}
          className="whitespace-nowrap underline-offset-4 hover:underline"
        >
          {row.original.company.name}
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    id: "email",
    header: "Email",
    cell: ({ row }) =>
      row.original.email ? (
        <div className="flex flex-col items-start gap-1">
          <span className="font-mono text-xs">{row.original.email}</span>
          <div className="flex flex-wrap gap-1">
            <EmailStatusPill status={row.original.emailStatus} />
            {row.original.suppressed ? <SuppressedPill /> : null}
          </div>
        </div>
      ) : (
        <span className="text-muted-foreground">No email</span>
      ),
  },
  {
    id: "stage",
    header: "Stage",
    cell: ({ row }) => <ContactStagePill stage={row.original.stage} />,
  },
  {
    id: "owner",
    header: "Owner",
    cell: ({ row }) => (
      <span className="whitespace-nowrap">
        {row.original.owner?.name ?? <span className="text-muted-foreground">Unassigned</span>}
      </span>
    ),
  },
];

export function peopleColumns(selectable: boolean): ColumnDef<DataTableFeatures, PersonRow>[] {
  return selectable ? [selectColumn, ...dataColumns] : dataColumns;
}
