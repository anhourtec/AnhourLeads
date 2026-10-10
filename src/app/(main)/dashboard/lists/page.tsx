import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { pageActor } from "@/server/services/engage-context";
import { listLists } from "@/server/services/lists";

import { PageHeader } from "../_components/records/page-header";
import { ListFormDialog } from "./_components/list-form-dialog";
import { ListsTable } from "./_components/lists-table";

export const metadata: Metadata = { title: "Lists" };

export default async function ListsPage() {
  const { actor } = await pageActor("list:read");
  const lists = await listLists(actor);
  const permissions = {
    create: can(actor.role, "list:create"),
    update: can(actor.role, "list:update"),
    remove: can(actor.role, "list:delete"),
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Lists"
        description="Group people and companies to work on together. Dynamic lists keep themselves up to date from saved filters."
        actions={permissions.create ? <ListFormDialog mode="create" /> : null}
      />
      <ListsTable lists={lists} permissions={permissions} />
    </div>
  );
}
