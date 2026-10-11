import type { Metadata } from "next";

import { companyOptions } from "@/server/services/companies";
import { recordsPageActor } from "@/server/services/records";
import { loadSearchPage } from "@/server/services/search-page";

import { ImportMenu } from "../../_components/records/search/import-menu";
import { SearchShell } from "../../_components/records/search/search-shell";

export const metadata: Metadata = { title: "Saved people" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The people search, fixed to the "Saved" segment: people you own. */
export default async function SavedPeoplePage({ searchParams }: { searchParams: SearchParams }) {
  const { actor } = await recordsPageActor("contact:read");
  const data = await loadSearchPage(actor, "contact", await searchParams, { fixedSegment: "saved" });
  const companies = data.permissions.create ? await companyOptions(actor) : [];
  return (
    <SearchShell
      ctx={{
        entity: "contact",
        basePath: "/dashboard/saved/people",
        fixed: {},
        fixedSegment: "saved",
        currentUserId: actor.userId ?? "",
      }}
      title="Saved people"
      headerExtra={<p className="text-muted-foreground text-sm">People you own in this workspace.</p>}
      headerActions={
        <ImportMenu
          entity="contact"
          canCreate={data.permissions.create}
          canImport={data.permissions.import}
          members={data.options.members}
          companies={companies}
        />
      }
      alwaysShowResults
      {...data}
    />
  );
}
