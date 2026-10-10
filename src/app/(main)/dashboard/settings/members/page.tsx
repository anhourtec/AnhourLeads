import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { listInvitations, searchMembers } from "@/server/services/members";

import { ErrorState } from "../../_components/pipeline/error-state";
import { MembersManager } from "./_components/members-manager";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "member:read")) notFound();

  const loaded = await Promise.all([
    searchMembers(actor, {}, { page: 1, perPage: 100, offset: 0 }),
    can(actor.role, "member:invite") ? listInvitations(actor) : Promise.resolve([]),
  ]).catch((error: unknown) => {
    log.error("members failed to load", { component: "members", error });
    return null;
  });
  if (!loaded) return <ErrorState />;
  const [members, invitations] = loaded;

  return (
    <MembersManager
      members={members.users}
      total={members.total}
      invitations={invitations}
      role={actor.role}
      currentUserId={context.user.id}
      workspaceName={context.workspace?.name ?? ""}
    />
  );
}
