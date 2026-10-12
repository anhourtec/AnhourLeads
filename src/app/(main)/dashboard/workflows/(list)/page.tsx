import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { listTemplates, searchWorkflows } from "@/server/services/workflows";

import { ErrorState } from "../../_components/pipeline/error-state";
import { WorkflowsView } from "../_components/workflows-view";

export const metadata: Metadata = { title: "Workflows" };

export default async function WorkflowsPage({ searchParams }: PageProps<"/dashboard/workflows">) {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "workflow:read")) notFound();
  const tab = (await searchParams).tab === "templates" ? "templates" : "workflows";
  const workflows = await searchWorkflows(actor, {}).catch((error: unknown) => {
    log.error("workflows failed to load", { component: "workflows", error });
    return null;
  });
  if (!workflows) return <ErrorState />;
  return (
    <WorkflowsView
      tab={tab}
      workflows={workflows}
      templates={listTemplates()}
      canCreate={can(actor.role, "workflow:create")}
    />
  );
}
