"use client";

import { Building2 } from "lucide-react";

import { COMPANY_STAGE_LABELS, COMPANY_STAGES } from "@/lib/records-vocabulary";

import type { FilterField } from "../../_components/records/record-filters";
import type { PaginationInfo } from "../../_components/records/records-pagination";
import { RecordsTableView } from "../../_components/records/records-table-view";
import { CompaniesBulkActions } from "./companies-bulk-actions";
import { companiesColumns } from "./companies-columns";
import type { CompaniesPermissions, CompanyRow, Option } from "./types";

const FILTER_PARAMS = [
  "q",
  "stage",
  "industry",
  "country",
  "employeesMin",
  "employeesMax",
  "technologies",
  "ownerId",
  "listId",
];

function filterFields(members: Option[]): FilterField[] {
  return [
    {
      kind: "checkboxes",
      name: "stage",
      label: "Stage",
      options: COMPANY_STAGES.map((value) => ({ value, label: COMPANY_STAGE_LABELS[value] })),
    },
    {
      kind: "select",
      name: "ownerId",
      label: "Owner",
      emptyLabel: "Anyone",
      options: members.map((m) => ({ value: m.id, label: m.name })),
    },
    {
      kind: "text",
      name: "industry",
      label: "Industry",
      placeholder: "e.g. Software, Retail",
      hint: "Separate values with commas to match any of them.",
    },
    { kind: "text", name: "country", label: "Country", placeholder: "e.g. Canada, Germany" },
    { kind: "range", label: "Employees", minName: "employeesMin", maxName: "employeesMax" },
    { kind: "text", name: "technologies", label: "Uses technology", placeholder: "e.g. Salesforce, React" },
  ];
}

export function CompaniesView({
  rows,
  pagination,
  members,
  permissions,
  emptyActions,
}: {
  rows: CompanyRow[];
  pagination: PaginationInfo;
  members: Option[];
  permissions: CompaniesPermissions;
  emptyActions?: React.ReactNode;
}) {
  const selectable = permissions.update || permissions.delete;
  return (
    <RecordsTableView
      rows={rows}
      columns={companiesColumns(selectable)}
      selectable={selectable}
      pagination={pagination}
      noun="companies"
      fields={filterFields(members)}
      filterParams={FILTER_PARAMS}
      search={{ placeholder: "Search name or domain", label: "Search companies" }}
      bulkActions={(ids, clear) => (
        <CompaniesBulkActions ids={ids} members={members} permissions={permissions} onDone={clear} />
      )}
      empty={{
        icon: <Building2 aria-hidden="true" />,
        title: "No companies yet",
        description: "Companies you add or import show up here, with their people and where each value came from.",
        actions: emptyActions,
      }}
    />
  );
}
