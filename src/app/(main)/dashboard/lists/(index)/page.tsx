import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { pageActor } from "@/server/services/engage-context";
import { listLists } from "@/server/services/lists";
import { workspaceMembers } from "@/server/services/records";
import { searchOptions, searchPermissions } from "@/server/services/search-page";

import { ListsView } from "../_components/lists-view";

export const metadata: Metadata = { title: "My lists" };

const NO_OPTIONS = { members: [], lists: [], sequences: [], personas: [], customFields: [], importBatches: [] };

export default async function ListsPage() {
  const { actor } = await pageActor("list:read");
  const permissions = {
    create: can(actor.role, "list:create"),
    update: can(actor.role, "list:update"),
    remove: can(actor.role, "list:delete"),
  };
  const [lists, members, contactOptions, companyOptions] = await Promise.all([
    listLists(actor),
    workspaceMembers(actor),
    permissions.create ? searchOptions(actor, "contact") : Promise.resolve(NO_OPTIONS),
    permissions.create ? searchOptions(actor, "company") : Promise.resolve(NO_OPTIONS),
  ]);
  const names = new Map(members.map((m) => [m.id, m.name]));
  return (
    <ListsView
      lists={lists.map((l) => ({ ...l, ownerName: l.createdById ? (names.get(l.createdById) ?? null) : null }))}
      permissions={permissions}
      picker={{
        contact: { options: contactOptions, permissions: searchPermissions(actor, "contact") },
        company: { options: companyOptions, permissions: searchPermissions(actor, "company") },
      }}
    />
  );
}
