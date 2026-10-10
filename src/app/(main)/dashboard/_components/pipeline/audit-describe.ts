import type { AuditLogDto } from "@/server/services/audit-log";

/** Plain-language descriptions of audit actions. Unknown actions fall back to the raw name. */
const ACTIONS: Record<string, string> = {
  "workspace.create": "created the workspace",
  "workspace.update": "renamed the workspace",
  "member.invite": "invited someone",
  "member.invite_cancel": "cancelled an invitation",
  "member.role_change": "changed a member's role",
  "member.remove": "removed a member",
  "apikey.create": "created an API key",
  "apikey.revoke": "revoked an API key",
  "task.create": "created a task",
  "task.bulk_create": "created tasks in bulk",
  "task.update": "updated a task",
  "task.complete": "completed a task",
  "task.skip": "skipped a task",
  "task.delete": "deleted a task",
  "deal.create": "created a deal",
  "deal.update": "updated a deal",
  "deal.delete": "deleted a deal",
  "suppression.create": "added to do not contact",
  "suppression.bulk_create": "added entries to do not contact",
  "suppression.delete": "removed from do not contact",
  "privacy.erase": "erased a person's data",
  "privacy.export": "exported a person's data",
  "contact.create": "added a person",
  "contact.update": "updated a person",
  "contact.delete": "deleted a person",
  "contact.import": "imported people",
  "contact.export": "exported people",
  "company.create": "added a company",
  "company.update": "updated a company",
  "company.delete": "deleted a company",
  "branding.update": "updated the branding",
};

export function describeAction(action: string): string {
  return ACTIONS[action] ?? action.replace(/[._]/g, " ");
}

export function actorLabel(entry: Pick<AuditLogDto, "actor">): string {
  const { actor } = entry;
  if (actor.kind === "user") return actor.name ?? actor.email ?? "Former member";
  if (actor.kind === "apiKey") return actor.name ? `API key "${actor.name}"` : "An API key";
  return "System";
}
