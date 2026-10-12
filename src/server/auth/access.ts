import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

/**
 * Access control for Better Auth's own organization endpoints (members, invitations).
 * Product permissions live in src/lib/rbac/permissions.ts; these only gate the plugin's routes.
 */
export const ac = createAccessControl(defaultStatements);

const none = { organization: [], member: [], invitation: [], team: [], ac: ["read"] } as const;

export const orgRoles = {
  owner: ac.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  }),
  admin: ac.newRole({
    organization: ["update"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    team: ["create", "update", "delete"],
    ac: ["create", "read", "update", "delete"],
  }),
  manager: ac.newRole({ ...none }),
  member: ac.newRole({ ...none }),
  viewer: ac.newRole({ ...none }),
};
