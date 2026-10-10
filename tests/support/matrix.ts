import { can, type Permission, ROLES, type Role } from "../../src/lib/rbac/permissions";

export type { Role };
export { ROLES };

/** Expected status for a role: `allowed` when the matrix grants `permission`, else 403. */
export function expected(role: Role, permission: Permission, allowed = 200): number {
  return can(role, permission) ? allowed : 403;
}
