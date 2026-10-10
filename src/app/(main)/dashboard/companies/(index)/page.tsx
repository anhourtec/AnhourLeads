import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { HttpError } from "@/server/http/errors";
import { pageFrom } from "@/server/http/route";
import { type CompanySearch, companySearchSchema, searchCompanies } from "@/server/services/companies";
import { recordsPageActor, workspaceMembers } from "@/server/services/records";

import { CsvImportDialog } from "../../_components/records/csv-import-dialog";
import { ExportButton } from "../../_components/records/export-button";
import { PageHeader } from "../../_components/records/page-header";
import { CompaniesView } from "../_components/companies-view";
import { CompanyFormDialog } from "../_components/company-form-dialog";

export const metadata: Metadata = { title: "Companies" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await recordsPageActor("company:read");
  const raw = await searchParams;
  const parsed = companySearchSchema.safeParse(raw);
  const filters: CompanySearch = parsed.success ? parsed.data : {};
  const page = pageFrom(raw);

  // A stale owner or list id in the URL shouldn't break the page: drop it and search again.
  const result = await searchCompanies(actor, filters, page).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) {
      return searchCompanies(actor, { ...filters, ownerId: undefined, listId: undefined }, page);
    }
    throw error;
  });

  const permissions = {
    create: can(actor.role, "company:create"),
    update: can(actor.role, "company:update"),
    delete: can(actor.role, "company:delete"),
    import: can(actor.role, "company:import"),
    export: can(actor.role, "company:export"),
  };
  const members = await workspaceMembers(actor);
  const total = result.pagination.total_entries;
  const filtered = Object.entries(filters).some(
    ([key, value]) => !key.startsWith("sort") && value !== undefined && !(Array.isArray(value) && !value.length),
  );

  const importDialog = permissions.import ? (
    <CsvImportDialog
      endpoint="/api/v1/accounts/import"
      noun="companies"
      dedupeHint="Rows are matched to existing companies by domain, or by exact name when there is no domain."
      columnsHint="Recognised columns include name, domain, website, industry, employees, annual revenue, founded, technologies, keywords, phone, LinkedIn, city, state, country and stage."
    />
  ) : null;
  const addDialog = permissions.create ? <CompanyFormDialog members={members} /> : null;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Companies"
        description={
          <>
            <span className="font-mono tabular-nums">{total.toLocaleString("en-US")}</span>{" "}
            {total === 1 ? "company" : "companies"}{" "}
            {filtered ? `${total === 1 ? "matches" : "match"} your filters` : "in this workspace"}.
          </>
        }
        actions={
          <>
            {importDialog}
            {permissions.export ? <ExportButton endpoint="/api/v1/accounts/export" /> : null}
            {addDialog}
          </>
        }
      />
      <CompaniesView
        rows={result.accounts}
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
