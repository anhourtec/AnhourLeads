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
  "contact.bulk_create": "added people in bulk",
  "contact.bulk_update": "updated people in bulk",
  "contact.bulk_delete": "deleted people in bulk",
  "contact.update_stages": "changed people's stage",
  "contact.update_owners": "changed people's owner",
  "company.create": "added a company",
  "company.update": "updated a company",
  "company.delete": "deleted a company",
  "company.import": "imported companies",
  "company.export": "exported companies",
  "company.bulk_create": "added companies in bulk",
  "company.bulk_update": "updated companies in bulk",
  "company.bulk_delete": "deleted companies in bulk",
  "company.update_owners": "changed companies' owner",
  "list.create": "created a list",
  "list.update": "updated a list",
  "list.delete": "deleted a list",
  "crawl_job.create": "started a crawl",
  "crawl_job.apply": "applied crawl findings",
  "sequence.create": "created a sequence",
  "sequence.update": "updated a sequence",
  "sequence.activate": "activated a sequence",
  "sequence.pause": "paused a sequence",
  "sequence.archive": "archived a sequence",
  "sequence.delete": "deleted a sequence",
  "sequence.enroll": "enrolled people in a sequence",
  "message.approve": "approved a message",
  "message.send_now": "sent a message now",
  "mailbox.create": "added a mailbox",
  "mailbox.update": "updated a mailbox",
  "mailbox.delete": "removed a mailbox",
  "mailbox.test": "tested a mailbox",
  "suppression.unsubscribe": "unsubscribed from emails",
  "domain.add": "added a hostname",
  "domain.verify": "verified a hostname",
  "domain.verify_failed": "couldn't verify a hostname",
  "domain.failing": "flagged a failing hostname",
  "domain.switched_off": "switched off a hostname",
  "domain.remove": "removed a hostname",
  "domain.limit_update": "changed the hostname limit",
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
