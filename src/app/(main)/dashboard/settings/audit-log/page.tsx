import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { pageFrom, pagination } from "@/server/http/route";
import { log } from "@/server/log";
import { auditEntityTypes, searchAuditLog } from "@/server/services/audit-log";
import { searchMembers } from "@/server/services/members";

import { ErrorState } from "../../_components/pipeline/error-state";
import { PageHeader } from "../../_components/pipeline/page-header";
import { AuditLogView } from "./_components/audit-log-view";

export const metadata: Metadata = { title: "Audit log" };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function AuditLogPage({ searchParams }: PageProps<"/dashboard/settings/audit-log">) {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "audit:read")) notFound();

  const sp = await searchParams;
  const one = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : "");
  const from = DATE.test(one("from")) ? new Date(`${one("from")}T00:00:00Z`) : undefined;
  const to = DATE.test(one("to")) ? new Date(`${one("to")}T23:59:59.999Z`) : undefined;
  const page = pageFrom({ page: one("page") || 1, per_page: 50 });

  const loaded = await Promise.all([
    searchAuditLog(
      actor,
      {
        action: one("action").slice(0, 80) || undefined,
        actorId: one("actor").slice(0, 64) || undefined,
        entityType: one("entity").slice(0, 40) || undefined,
        from,
        to,
      },
      page,
    ),
    auditEntityTypes(actor),
    searchMembers(actor, {}, { page: 1, perPage: 100, offset: 0 }),
  ]).catch((error: unknown) => {
    log.error("audit log failed to load", { component: "audit-log", error });
    return null;
  });

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Audit log"
        description="Who changed what in this workspace, by people and by API keys. Secrets are never recorded."
      />
      {loaded ? (
        <AuditLogView
          entries={loaded[0].auditLogs}
          pagination={pagination(page, loaded[0].total)}
          entityTypes={loaded[1]}
          members={loaded[2].users.map((m) => ({ id: m.id, name: m.name }))}
          now={new Date().toISOString()}
        />
      ) : (
        <ErrorState />
      )}
    </div>
  );
}
