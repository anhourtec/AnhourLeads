import type { Metadata } from "next";

import { recordsPageActor } from "@/server/services/records";
import { loadFindPage } from "@/server/services/search-page";

import { ImportMenu } from "../../_components/records/search/import-menu";
import { SearchShell } from "../../_components/records/search/search-shell";

export const metadata: Metadata = { title: "Find companies" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await recordsPageActor("company:read");
  const data = await loadFindPage(actor, "company", await searchParams);
  return (
    <SearchShell
      ctx={{ entity: "company", basePath: "/dashboard/companies", fixed: {}, currentUserId: actor.userId ?? "" }}
      title="Find companies"
      headerActions={
        <ImportMenu
          entity="company"
          canCreate={data.permissions.create}
          canImport={data.permissions.import}
          members={data.options.members}
          companies={[]}
        />
      }
      {...data}
    />
  );
}
