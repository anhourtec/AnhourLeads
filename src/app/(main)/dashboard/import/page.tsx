import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { listLists } from "@/server/services/lists";
import { IMPORT_MAX_ROWS } from "@/server/services/records";

import { ImportWizard } from "./_components/import-wizard";
import type { ImportEntityKey } from "./_components/types";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage({ searchParams }: PageProps<"/dashboard/import">) {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor) return null;
  const sp = await searchParams;
  const TYPES: Record<string, ImportEntityKey> = { contacts: "contacts", accounts: "accounts" };
  const type = typeof sp.type === "string" ? (TYPES[sp.type] ?? null) : null;
  const listId = typeof sp.listId === "string" ? sp.listId.slice(0, 100) : null;

  const permissions = {
    contacts: can(actor.role, "contact:import"),
    accounts: can(actor.role, "company:import"),
    enrich: can(actor.role, "enrich:run") && can(actor.role, "contact:update"),
    createList: can(actor.role, "list:create"),
    updateList: can(actor.role, "list:update"),
  };
  const lists = permissions.updateList ? await listLists(actor) : [];
  const staticLists = lists
    .filter((l) => l.kind === "static")
    .map((l) => ({ id: l.id, name: l.name, entityType: l.entityType }));
  // A list id from the URL only preselects when it's a static list in this workspace.
  const preselected = staticLists.find((l) => l.id === listId) ?? null;
  const fromList: ImportEntityKey | null = preselected?.entityType === "company" ? "accounts" : null;
  const listType: ImportEntityKey | null = preselected?.entityType === "contact" ? "contacts" : fromList;
  const initialType: ImportEntityKey | null = (type && permissions[type] ? type : null) ?? listType;

  return (
    <ImportWizard
      permissions={permissions}
      lists={staticLists}
      maxRows={IMPORT_MAX_ROWS}
      initialType={initialType}
      initialListId={preselected?.id ?? null}
    />
  );
}
