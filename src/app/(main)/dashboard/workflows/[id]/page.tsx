import { notFound } from "next/navigation";

import { and, asc, eq, ne } from "drizzle-orm";
import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { db, schema } from "@/server/db";
import { HttpError } from "@/server/http/errors";
import { log } from "@/server/log";
import { listPipelines } from "@/server/services/pipelines";
import { listRecordStages } from "@/server/services/record-stages";
import { workspaceMembers } from "@/server/services/records";
import { getWorkflow } from "@/server/services/workflows";

import { ErrorState } from "../../_components/pipeline/error-state";
import { Builder } from "./_components/builder";

export const metadata: Metadata = { title: "Workflow" };

export default async function WorkflowPage({ params }: PageProps<"/dashboard/workflows/[id]">) {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "workflow:read")) notFound();
  const { id } = await params;
  const workflow = await getWorkflow(actor, id).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  });
  if (!workflow) notFound();
  const org = actor.organizationId;
  const loaded = await Promise.all([
    db
      .select({
        id: schema.list.id,
        name: schema.list.name,
        entityType: schema.list.entityType,
        kind: schema.list.kind,
      })
      .from(schema.list)
      .where(eq(schema.list.organizationId, org))
      .orderBy(asc(schema.list.name)),
    db
      .select({ id: schema.sequence.id, name: schema.sequence.name })
      .from(schema.sequence)
      .where(and(eq(schema.sequence.organizationId, org), ne(schema.sequence.status, "archived")))
      .orderBy(asc(schema.sequence.name)),
    listPipelines(actor),
    workspaceMembers(actor),
    listRecordStages(org, "contact"),
    listRecordStages(org, "company"),
  ]).catch((error: unknown) => {
    log.error("workflow builder failed to load", { component: "workflows", error });
    return null;
  });
  if (!loaded) return <ErrorState />;
  const [lists, sequences, pipelines, members, contactStages, companyStages] = loaded;
  return (
    <Builder
      workflow={workflow}
      data={{
        lists,
        sequences,
        pipelines: pipelines.map((p) => ({
          id: p.id,
          name: p.name,
          stages: p.stages.map((s) => ({ id: s.id, name: s.name })),
        })),
        members,
        contactStages: contactStages.map((s) => ({ key: s.key, label: s.label })),
        companyStages: companyStages.map((s) => ({ key: s.key, label: s.label })),
      }}
      permissions={{
        update: can(actor.role, "workflow:update"),
        launch: can(actor.role, "workflow:launch"),
        remove: can(actor.role, "workflow:delete"),
      }}
    />
  );
}
