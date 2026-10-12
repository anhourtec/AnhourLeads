/**
 * Workspace roles and the permission matrix.
 *
 * Single source of truth for who can do what. The API (`route()` in src/server/http/route.ts),
 * the navigation (src/navigation/sidebar/sidebar-items.ts) and the RBAC harness (tests/api) all
 * read from here. Any change updates docs/roles.md in the same commit.
 */

export const ROLES = ["owner", "admin", "manager", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Administrator",
  manager: "Manager",
  member: "Member",
  viewer: "Viewer",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: "Full control, including deleting the workspace and transferring ownership.",
  admin: "Manages people, API keys, branding and domains, plus everything a manager can do.",
  manager: "Runs the team's data and outreach: deletes records, manages mailboxes and the do-not-contact list.",
  member: "Day-to-day prospecting: adds and edits records, enriches, crawls and runs sequences.",
  viewer: "Read-only access to data, sequences and reports. Cannot export.",
};

export const PERMISSIONS = [
  // Prospecting data
  "contact:read",
  "contact:create",
  "contact:update",
  "contact:delete",
  "contact:import",
  "contact:export",
  "company:read",
  "company:create",
  "company:update",
  "company:delete",
  "company:import",
  "company:export",
  "search:run",
  "enrich:run",
  "list:read",
  "list:create",
  "list:update",
  "list:delete",
  // Engagement
  "sequence:read",
  "sequence:create",
  "sequence:update",
  "sequence:delete",
  "sequence:launch",
  "mailbox:read",
  "mailbox:create",
  "mailbox:update",
  "mailbox:delete",
  // Pipeline
  "task:read",
  "task:create",
  "task:update",
  "task:delete",
  "deal:read",
  "deal:create",
  "deal:update",
  "deal:delete",
  // Research
  "crawler:read",
  "crawler:run",
  // Compliance
  "suppression:read",
  "suppression:create",
  "suppression:delete",
  // Workspace administration
  "member:read",
  "member:invite",
  "member:update",
  "member:remove",
  "apikey:read",
  "apikey:create",
  "apikey:revoke",
  "audit:read",
  "workspace:update",
  "workspace:delete",
  "branding:update",
  "domain:read",
  "domain:manage",
  // Apollo-parity additions (docs/reference/apollo-ui.md)
  "savedsearch:create",
  "note:create",
  "note:delete",
  "template:read",
  "template:create",
  "template:update",
  "template:delete",
  "schedule:manage",
  "workflow:read",
  "workflow:create",
  "workflow:update",
  "workflow:delete",
  "workflow:launch",
  "pipeline:manage",
  "stage:manage",
  "customfield:manage",
  "persona:manage",
  "analytics:read",
  "dashboard:manage",
  "deliverability:read",
  "deliverability:manage",
  "ai:use",
  "aicontext:manage",
  // Bring-your-own data providers (workspace's own API keys)
  "provider:manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ: Permission[] = PERMISSIONS.filter((p) => p.endsWith(":read")).filter(
  (p) => !["apikey:read", "audit:read", "domain:read", "deliverability:read"].includes(p),
);

const VIEWER: Permission[] = [...READ, "search:run", "analytics:read"];

const MEMBER: Permission[] = [
  ...VIEWER,
  "contact:create",
  "contact:update",
  "contact:import",
  "contact:export",
  "company:create",
  "company:update",
  "company:import",
  "company:export",
  "enrich:run",
  "list:create",
  "list:update",
  "sequence:create",
  "sequence:update",
  "sequence:launch",
  "task:create",
  "task:update",
  "task:delete",
  "deal:create",
  "deal:update",
  "crawler:run",
  "suppression:create",
  "savedsearch:create",
  "note:create",
  "template:create",
  "template:update",
  "workflow:create",
  "workflow:update",
  "workflow:launch",
  "ai:use",
];

const MANAGER: Permission[] = [
  ...MEMBER,
  "contact:delete",
  "company:delete",
  "list:delete",
  "sequence:delete",
  "mailbox:create",
  "mailbox:update",
  "mailbox:delete",
  "deal:delete",
  "suppression:delete",
  "audit:read",
  "domain:read",
  "note:delete",
  "template:delete",
  "schedule:manage",
  "workflow:delete",
  "persona:manage",
  "dashboard:manage",
  "deliverability:read",
];

const ADMIN: Permission[] = [
  ...MANAGER,
  "member:invite",
  "member:update",
  "member:remove",
  "apikey:read",
  "apikey:create",
  "apikey:revoke",
  "workspace:update",
  "branding:update",
  "domain:manage",
  "pipeline:manage",
  "stage:manage",
  "customfield:manage",
  "deliverability:manage",
  "aicontext:manage",
  "provider:manage",
];

const OWNER: Permission[] = [...ADMIN, "workspace:delete"];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set(OWNER),
  admin: new Set(ADMIN),
  manager: new Set(MANAGER),
  member: new Set(MEMBER),
  viewer: new Set(VIEWER),
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].has(permission) : false;
}

/** Rank used for guard rails: nobody may grant or act on a role above their own. */
export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, manager: 2, admin: 3, owner: 4 };

export function outranksOrEquals(actor: Role, target: Role): boolean {
  return ROLE_RANK[actor] >= ROLE_RANK[target];
}
