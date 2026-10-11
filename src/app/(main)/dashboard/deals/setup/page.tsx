import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { listPipelines } from "@/server/services/pipelines";

import { ErrorState } from "../../_components/pipeline/error-state";
import { SetupFlow } from "./_components/setup-flow";

export const metadata: Metadata = { title: "Set up deals" };

export default async function DealsSetupPage() {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "deal:read")) notFound();
  const pipelines = await listPipelines(actor).catch((error: unknown) => {
    log.error("pipelines failed to load", { component: "deals", error });
    return null;
  });
  const pipeline = pipelines?.find((p) => p.isDefault) ?? pipelines?.[0];
  if (!pipeline) return <ErrorState />;
  return (
    <SetupFlow
      pipeline={pipeline}
      canManage={can(actor.role, "pipeline:manage")}
      canCreateDeal={can(actor.role, "deal:create")}
      brandName={context.brand.name}
    />
  );
}
