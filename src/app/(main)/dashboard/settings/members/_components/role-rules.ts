import { outranksOrEquals, ROLES, type Role } from "@/lib/rbac/permissions";

/** Roles the actor may grant (mirrors the API guard rails, which stay authoritative). */
export function grantableRoles(actor: Role): Role[] {
  return ROLES.filter((r) => outranksOrEquals(actor, r) && (r !== "owner" || actor === "owner"));
}

/** Whether the actor may change or remove a member with `target` role. */
export function canManage(actor: Role, target: Role): boolean {
  if (target === "owner") return actor === "owner";
  return outranksOrEquals(actor, target);
}
