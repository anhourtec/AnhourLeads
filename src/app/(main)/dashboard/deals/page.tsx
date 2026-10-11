import { notFound } from "next/navigation";

import { and, asc, eq } from "drizzle-orm";
import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { db, schema } from "@/server/db";
import { log } from "@/server/log";
import { dealAnalytics, searchDeals } from "@/server/services/deals";
import { listPipelines } from "@/server/services/pipelines";
import { workspaceMembers } from "@/server/services/records";

import { ErrorState } from "../_components/pipeline/error-state";
import type { DealPrefill } from "./_components/deal-form-dialog";
import { parseDealParams } from "./_components/deal-params";
import { DealsAnalytics } from "./_components/deals-analytics";
import { DealsView } from "./_components/deals-view";

export const metadata: Metadata = { title: "Deals" };

/** The board shows up to this many deals; totals always cover every deal. */
const LIMIT = 200;

/** Person (and their company) to start a new deal with, when they're in this workspace. */
async function contactPrefill(organizationId: string, contactId: string): Promise<DealPrefill | null> {
  const [row] = await db
    .select({
      id: schema.contact.id,
      firstName: schema.contact.firstName,
      lastName: schema.contact.lastName,
      email: schema.contact.email,
      companyId: schema.company.id,
      companyName: schema.company.name,
      companyDomain: schema.company.domain,
    })
    .from(schema.contact)
    .leftJoin(schema.company, eq(schema.company.id, schema.contact.companyId))
    .where(and(eq(schema.contact.organizationId, organizationId), eq(schema.contact.id, contactId)))
    .limit(1);
  if (!row) return null;
  const name = [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email || "Unnamed person";
  return {
    contact: { id: row.id, name, detail: row.email },
    company:
      row.companyId && row.companyName ? { id: row.companyId, name: row.companyName, detail: row.companyDomain } : null,
  };
}

export default async function DealsPage({ searchParams }: PageProps<"/dashboard/deals">) {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "deal:read")) notFound();

  const params = parseDealParams(await searchParams);
  const pipelines = await listPipelines(actor).catch((error: unknown) => {
    log.error("pipelines failed to load", { component: "deals", error });
    return null;
  });
  if (!pipelines?.length) return <ErrorState />;
  const fallback = pipelines.find((p) => p.isDefault) ?? pipelines[0];
  const chosen = pipelines.find((p) => p.id === params.pipeline);
  // The board always shows one pipeline; the table can show all of them.
  const pipeline = chosen ?? (params.view === "table" && params.pipeline === "all" ? null : fallback);

  const loaded = await Promise.all([
    params.tab === "analytics"
      ? dealAnalytics(actor, { pipelineId: pipeline?.id })
      : searchDeals(
          actor,
          {
            q: params.q || undefined,
            pipelineId: pipeline?.id,
            ownerIds: params.owners.length ? params.owners : undefined,
            stageIds: params.stages.length ? params.stages : undefined,
            closeDateFrom: params.closeFrom ? new Date(params.closeFrom) : undefined,
            closeDateTo: params.closeTo ? new Date(`${params.closeTo}T23:59:59Z`) : undefined,
            amountMin: params.amountMin ?? undefined,
            amountMax: params.amountMax ?? undefined,
            companyName: params.company || undefined,
            sort_by_field: params.sort,
            sort_ascending: params.sort === "close_date",
          },
          { page: 1, perPage: LIMIT, offset: 0 },
        ),
    workspaceMembers(actor),
    db
      .select({
        key: schema.customField.key,
        label: schema.customField.label,
        type: schema.customField.type,
        options: schema.customField.options,
      })
      .from(schema.customField)
      .where(
        and(eq(schema.customField.organizationId, actor.organizationId), eq(schema.customField.entityType, "deal")),
      )
      .orderBy(asc(schema.customField.position)),
  ]).catch((error: unknown) => {
    log.error("deals failed to load", { component: "deals", error });
    return null;
  });
  if (!loaded) return <ErrorState />;
  const [data, members, customFields] = loaded;
  const prefill =
    params.create && params.contactId ? await contactPrefill(actor.organizationId, params.contactId) : null;

  return (
    <DealsView
      params={params}
      pipelines={pipelines}
      pipelineId={pipeline?.id ?? null}
      result={"deals" in data ? data : null}
      limit={LIMIT}
      members={members}
      customFields={customFields}
      currentUserId={context.user.id}
      prefill={prefill}
      role={actor.role}
      analytics={
        "deals" in data ? null : (
          <DealsAnalytics key="analytics" data={data} pipelineName={pipeline?.name ?? "All pipelines"} />
        )
      }
    />
  );
}
