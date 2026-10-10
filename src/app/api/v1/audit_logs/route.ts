import { pageFrom, pagination, route } from "@/server/http/route";
import { auditLogSearchSchema, searchAuditLog } from "@/server/services/audit-log";

/** Audit trail. Filters: action (prefix), actorId, apiKeyId, entityType, entityId, from, to. */
export const GET = route(
  async ({ req, actor }) => {
    const query = Object.fromEntries(req.nextUrl.searchParams);
    const page = pageFrom(query);
    const { auditLogs, total } = await searchAuditLog(actor, auditLogSearchSchema.parse(query), page);
    return { audit_logs: auditLogs, pagination: pagination(page, total) };
  },
  { permission: "audit:read" },
);
