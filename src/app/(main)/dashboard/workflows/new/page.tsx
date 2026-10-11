import { and, eq } from "drizzle-orm";
import type { Metadata } from "next";

import { filtersFromObject } from "@/lib/search/filters";
import { type EnrollmentFilters, enrollmentFromSearch, type WorkflowTarget } from "@/lib/workflows";
import { getAppContext } from "@/server/auth/context";
import { db, schema } from "@/server/db";
import { listTemplates } from "@/server/services/workflows";

import { type Prefill, StartScreen } from "../_components/start-screen";

export const metadata: Metadata = { title: "New workflow" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Entry points: `?from=search&entity=contact|company&filters=<JSON>` and `?from=list&listId=<id>`. */
async function prefillFrom(
  organizationId: string,
  sp: Record<string, string | string[] | undefined>,
): Promise<Prefill | null> {
  const from = one(sp.from);
  if (from === "search") {
    const entity: WorkflowTarget = one(sp.entity) === "company" ? "company" : "contact";
    let raw: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(one(sp.filters) || "{}");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
    } catch {
      raw = {};
    }
    const { filters, dropped } = enrollmentFromSearch(entity, filtersFromObject(raw));
    return { source: "search", targetType: entity, enrollmentFilters: await scoped(organizationId, filters), dropped };
  }
  if (from === "list") {
    const listId = one(sp.listId);
    const [list] = await db
      .select({ id: schema.list.id, name: schema.list.name, entityType: schema.list.entityType })
      .from(schema.list)
      .where(and(eq(schema.list.organizationId, organizationId), eq(schema.list.id, listId)))
      .limit(1);
    if (!list) return null;
    return {
      source: "list",
      listName: list.name,
      targetType: list.entityType,
      enrollmentFilters: { listId: list.id },
      ...(list.entityType === "contact"
        ? { triggerEvent: "contact_added_to_list" }
        : { triggerType: "schedule" as const }),
      dropped: [],
    };
  }
  return null;
}

/** Drop list / owner references that aren't in this workspace. */
async function scoped(organizationId: string, f: EnrollmentFilters): Promise<EnrollmentFilters> {
  const out = { ...f };
  if (out.listId) {
    const [row] = await db
      .select({ id: schema.list.id })
      .from(schema.list)
      .where(and(eq(schema.list.organizationId, organizationId), eq(schema.list.id, out.listId)))
      .limit(1);
    if (!row) delete out.listId;
  }
  if (out.ownerId) {
    const [row] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, organizationId), eq(schema.member.userId, out.ownerId)))
      .limit(1);
    if (!row) delete out.ownerId;
  }
  return out;
}

export default async function NewWorkflowPage({ searchParams }: PageProps<"/dashboard/workflows/new">) {
  const { workspace } = await getAppContext();
  const prefill = workspace ? await prefillFrom(workspace.organizationId, await searchParams) : null;
  const featured = ["icp-to-sequence", "deal-won-notify", "new-hires"];
  const templates = listTemplates().filter((t) => featured.includes(t.id));
  return <StartScreen templates={templates} prefill={prefill} />;
}
