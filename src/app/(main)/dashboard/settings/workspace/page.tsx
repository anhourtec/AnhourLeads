import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { getWorkspace } from "@/server/services/workspace";

import { ErrorState } from "../../_components/pipeline/error-state";
import { PageHeader } from "../../_components/pipeline/page-header";
import { WorkspaceDetails } from "./_components/workspace-details";

export const metadata: Metadata = { title: "Workspace details" };

export default async function WorkspacePage() {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "member:read")) notFound();
  const workspace = await getWorkspace(actor).catch((error: unknown) => {
    log.error("workspace details failed to load", { component: "workspace", error });
    return null;
  });

  return (
    <div className="flex max-w-3xl flex-col gap-4 md:gap-6">
      <PageHeader title="Workspace details" description="The workspace's name and who's in it." />
      {workspace ? (
        <WorkspaceDetails
          workspace={workspace}
          canRename={can(actor.role, "workspace:update")}
          canDelete={can(actor.role, "workspace:delete")}
        />
      ) : (
        <ErrorState />
      )}
    </div>
  );
}
