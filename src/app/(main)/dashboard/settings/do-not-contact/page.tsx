import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { pageFrom, pagination } from "@/server/http/route";
import { log } from "@/server/log";
import { listSuppressions } from "@/server/services/suppressions";

import { ErrorState } from "../../_components/pipeline/error-state";
import { PageHeader } from "../../_components/pipeline/page-header";
import { AddEntryDialog } from "./_components/add-entry-dialog";
import { BulkAddDialog } from "./_components/bulk-add-dialog";
import { CheckAddress } from "./_components/check-address";
import { DataRequests } from "./_components/data-requests";
import { EntriesList } from "./_components/entries-list";

export const metadata: Metadata = { title: "Do not contact" };

export default async function DoNotContactPage({ searchParams }: PageProps<"/dashboard/settings/do-not-contact">) {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "suppression:read")) notFound();
  const role = actor.role;

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";
  const kind = sp.kind === "email" || sp.kind === "domain" ? sp.kind : undefined;
  const page = pageFrom({ page: typeof sp.page === "string" ? sp.page : 1, per_page: 25 });

  const result = await listSuppressions(actor, { q: q ? q : undefined, kind }, page).catch((error: unknown) => {
    log.error("suppressions failed to load", { component: "suppressions", error });
    return null;
  });

  const canCreate = can(role, "suppression:create");
  const canErase = can(role, "contact:delete") && canCreate;
  const canExport = can(role, "contact:export");

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Do not contact"
        description="Addresses and domains on this list are never enrolled or emailed. Adding one stops any sequences already running for matching people."
        actions={
          canCreate ? (
            <>
              <BulkAddDialog />
              <AddEntryDialog />
            </>
          ) : null
        }
      />
      <div className="grid grid-cols-1 gap-4 md:gap-6 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-4 md:gap-6 xl:col-span-8">
          {result ? (
            <EntriesList
              entries={result.suppressions}
              pagination={pagination(page, result.total)}
              canDelete={can(role, "suppression:delete")}
              canCreate={canCreate}
            />
          ) : (
            <ErrorState />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-4 md:gap-6 xl:col-span-4">
          <CheckAddress />
          {canErase || canExport ? <DataRequests canErase={canErase} canExport={canExport} /> : null}
        </div>
      </div>
    </div>
  );
}
