import type { Metadata } from "next";

import { recordsPageActor } from "@/server/services/records";
import { loadSearchPage } from "@/server/services/search-page";

import { ImportMenu } from "../../_components/records/search/import-menu";
import { SearchShell } from "../../_components/records/search/search-shell";

export const metadata: Metadata = { title: "Saved companies" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The company search, fixed to the "Saved" segment: companies you own. */
export default async function SavedCompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await recordsPageActor("company:read");
  const data = await loadSearchPage(actor, "company", await searchParams, { fixedSegment: "saved" });
  return (
    <SearchShell
      ctx={{
        entity: "company",
        basePath: "/dashboard/saved/companies",
        fixed: {},
        fixedSegment: "saved",
        currentUserId: actor.userId ?? "",
      }}
      title="Saved companies"
      headerExtra={<p className="text-muted-foreground text-sm">Companies you own in this workspace.</p>}
      headerActions={
        <ImportMenu
          entity="company"
          canCreate={data.permissions.create}
          canImport={data.permissions.import}
          members={data.options.members}
          companies={[]}
        />
      }
      alwaysShowResults
      {...data}
    />
  );
}
