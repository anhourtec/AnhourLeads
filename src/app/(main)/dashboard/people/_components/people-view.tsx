"use client";

import { Users } from "lucide-react";

import {
  CONTACT_STAGE_LABELS,
  CONTACT_STAGES,
  EMAIL_STATUS_LABELS,
  EMAIL_STATUSES,
  SENIORITIES,
  SENIORITY_LABELS,
} from "@/lib/records-vocabulary";

import type { FilterField } from "../../_components/records/record-filters";
import type { PaginationInfo } from "../../_components/records/records-pagination";
import { RecordsTableView } from "../../_components/records/records-table-view";
import { PeopleBulkActions } from "./people-bulk-actions";
import { peopleColumns } from "./people-columns";
import type { Option, PeoplePermissions, PersonRow } from "./types";

const FILTER_PARAMS = [
  "q",
  "stage",
  "emailStatus",
  "seniority",
  "title",
  "department",
  "country",
  "industry",
  "employeesMin",
  "employeesMax",
  "ownerId",
  "companyId",
  "listId",
  "tags",
];

function filterFields(members: Option[]): FilterField[] {
  return [
    {
      kind: "checkboxes",
      name: "stage",
      label: "Stage",
      options: CONTACT_STAGES.map((value) => ({ value, label: CONTACT_STAGE_LABELS[value] })),
    },
    {
      kind: "checkboxes",
      name: "emailStatus",
      label: "Email status",
      options: EMAIL_STATUSES.map((value) => ({ value, label: EMAIL_STATUS_LABELS[value] })),
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
      name: "title",
      label: "Title contains",
      placeholder: "e.g. sales, revenue",
      hint: "Separate words with commas to match any of them.",
    },
    {
      kind: "checkboxes",
      name: "seniority",
      label: "Seniority",
      options: SENIORITIES.map((value) => ({ value, label: SENIORITY_LABELS[value] })),
    },
    { kind: "text", name: "department", label: "Department", placeholder: "e.g. Sales, Marketing" },
    { kind: "text", name: "country", label: "Country", placeholder: "e.g. Canada, Germany" },
    { kind: "text", name: "industry", label: "Company industry", placeholder: "e.g. Software" },
    { kind: "range", label: "Company employees", minName: "employeesMin", maxName: "employeesMax" },
  ];
}

export function PeopleView({
  rows,
  pagination,
  members,
  permissions,
  emptyActions,
}: {
  rows: PersonRow[];
  pagination: PaginationInfo;
  members: Option[];
  permissions: PeoplePermissions;
  emptyActions?: React.ReactNode;
}) {
  const selectable = permissions.update || permissions.delete;
  return (
    <RecordsTableView
      rows={rows}
      columns={peopleColumns(selectable)}
      selectable={selectable}
      pagination={pagination}
      noun="people"
      fields={filterFields(members)}
      filterParams={FILTER_PARAMS}
      search={{ placeholder: "Search name, email, title or company", label: "Search people" }}
      bulkActions={(ids, clear) => (
        <PeopleBulkActions ids={ids} members={members} permissions={permissions} onDone={clear} />
      )}
      empty={{
        icon: <Users aria-hidden="true" />,
        title: "No people yet",
        description: "People you add or import show up here, with where each value came from.",
        actions: emptyActions,
      }}
    />
  );
}
