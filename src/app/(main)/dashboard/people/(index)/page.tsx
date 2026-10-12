import type { Metadata } from "next";

import { companyOptions } from "@/server/services/companies";
import { recordsPageActor } from "@/server/services/records";
import { loadFindPage } from "@/server/services/search-page";

import { ImportMenu } from "../../_components/records/search/import-menu";
import { SearchShell } from "../../_components/records/search/search-shell";

export const metadata: Metadata = { title: "Find people" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function PeoplePage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await recordsPageActor("contact:read");
  const data = await loadFindPage(actor, "contact", await searchParams);
  const companies = data.permissions.create ? await companyOptions(actor) : [];
  return (
    <SearchShell
      ctx={{ entity: "contact", basePath: "/dashboard/people", fixed: {}, currentUserId: actor.userId ?? "" }}
      title="Find people"
      headerActions={
        <ImportMenu
          entity="contact"
          canCreate={data.permissions.create}
          canImport={data.permissions.import}
          members={data.options.members}
          companies={companies}
        />
      }
      {...data}
    />
  );
}
