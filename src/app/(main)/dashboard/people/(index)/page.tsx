import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { HttpError } from "@/server/http/errors";
import { pageFrom } from "@/server/http/route";
import { companyOptions } from "@/server/services/companies";
import { type ContactSearch, contactSearchSchema, searchContacts } from "@/server/services/contacts";
import { recordsPageActor, workspaceMembers } from "@/server/services/records";

import { CsvImportDialog } from "../../_components/records/csv-import-dialog";
import { ExportButton } from "../../_components/records/export-button";
import { PageHeader } from "../../_components/records/page-header";
import { PeopleView } from "../_components/people-view";
import { PersonFormDialog } from "../_components/person-form-dialog";

export const metadata: Metadata = { title: "People" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PeoplePage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await recordsPageActor("contact:read");
  const raw = await searchParams;
  const parsed = contactSearchSchema.safeParse(raw);
  const filters: ContactSearch = parsed.success ? parsed.data : {};
  const page = pageFrom(raw);

  // A stale owner, company or list id in the URL shouldn't break the page: drop it and search again.
  const result = await searchContacts(actor, filters, page).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) {
      return searchContacts(actor, { ...filters, ownerId: undefined, companyId: undefined, listId: undefined }, page);
    }
    throw error;
  });

  const permissions = {
    create: can(actor.role, "contact:create"),
    update: can(actor.role, "contact:update"),
    delete: can(actor.role, "contact:delete"),
    import: can(actor.role, "contact:import"),
    export: can(actor.role, "contact:export"),
  };
  const [members, companies] = await Promise.all([
    workspaceMembers(actor),
    permissions.create ? companyOptions(actor) : Promise.resolve([]),
  ]);

  const total = result.pagination.total_entries;
  const filtered = Object.entries(filters).some(
    ([key, value]) => !key.startsWith("sort") && value !== undefined && !(Array.isArray(value) && !value.length),
  );
  const importDialog = permissions.import ? (
    <CsvImportDialog
      endpoint="/api/v1/contacts/import"
      noun="people"
      dedupeHint="Rows are matched to existing people by email."
      columnsHint="Recognised columns include first name, last name, full name, email, title, seniority, department, phone, LinkedIn, city, state, country, stage, tags, company and website."
    />
  ) : null;
  const addDialog = permissions.create ? <PersonFormDialog members={members} companies={companies} /> : null;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="People"
        description={
          <>
            <span className="font-mono tabular-nums">{total.toLocaleString("en-US")}</span>{" "}
            {total === 1 ? "person" : "people"}{" "}
            {filtered ? `${total === 1 ? "matches" : "match"} your filters` : "in this workspace"}.
          </>
        }
        actions={
          <>
            {importDialog}
            {permissions.export ? <ExportButton endpoint="/api/v1/contacts/export" /> : null}
            {addDialog}
          </>
        }
      />
      <PeopleView
        rows={result.contacts}
        pagination={result.pagination}
        members={members}
        permissions={permissions}
        emptyActions={
          addDialog || importDialog ? (
            <>
              {importDialog}
              {addDialog}
            </>
          ) : undefined
        }
      />
    </div>
  );
}
