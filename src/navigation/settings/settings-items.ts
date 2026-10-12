import { Database, Gauge, type LucideIcon, Palette, Plug, Send, Target, UserRound, UsersRound } from "lucide-react";

import { can, type Permission, type Role } from "@/lib/rbac/permissions";

/**
 * Settings navigation: the settings sidebar, the overview grid and the command palette's settings
 * results all read from here. Each link carries the permission its page checks, so a role never
 * sees a link that would answer 404.
 */
export interface SettingsLink {
  id: string;
  title: string;
  url: string;
  permission?: Permission;
  /** Extra words the settings search matches on. */
  keywords?: string[];
}

export interface SettingsGroup {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  links: SettingsLink[];
}

export const SETTINGS_OVERVIEW_URL = "/dashboard/settings";

export const settingsGroups: SettingsGroup[] = [
  {
    id: "personal",
    title: "Personal",
    description: "Your name, sign-in details and which notifications you get.",
    icon: UserRound,
    links: [
      {
        id: "profile",
        title: "Profile",
        url: "/dashboard/settings/profile",
        keywords: ["account", "name", "password", "security"],
      },
      {
        id: "notifications",
        title: "Notification settings",
        url: "/dashboard/settings/notifications",
        keywords: ["alerts", "email"],
      },
    ],
  },
  {
    id: "usage",
    title: "Usage & activity",
    description: "Provider lookups, data requests and everything that changed in the workspace.",
    icon: Gauge,
    links: [
      { id: "usage", title: "Usage", url: "/dashboard/settings/usage", keywords: ["credits", "lookups", "costs"] },
      {
        id: "audit-log",
        title: "Audit log",
        url: "/dashboard/settings/audit-log",
        permission: "audit:read",
        keywords: ["system activity", "history"],
      },
    ],
  },
  {
    id: "users",
    title: "Users & teams",
    description: "Invite teammates, set their roles and manage the workspace itself.",
    icon: UsersRound,
    links: [
      {
        id: "members",
        title: "Members",
        url: "/dashboard/settings/members",
        permission: "member:read",
        keywords: ["users", "teammates", "invite", "roles"],
      },
      {
        id: "workspace",
        title: "Workspace details",
        url: "/dashboard/settings/workspace",
        permission: "member:read",
        keywords: ["rename", "delete workspace"],
      },
    ],
  },
  {
    id: "integrations",
    title: "Integrations",
    description: "Connect other tools through the API, and your own data-provider accounts.",
    icon: Plug,
    links: [
      {
        id: "data-providers",
        title: "Data providers",
        url: "/dashboard/settings/data-providers",
        permission: "provider:manage",
        keywords: ["people data labs", "pdl", "apollo", "hunter", "enrichment", "bring your own"],
      },
      {
        id: "api-keys",
        title: "API keys",
        url: "/dashboard/settings/api-keys",
        permission: "apikey:read",
        keywords: ["api", "developer", "token"],
      },
    ],
  },
  {
    id: "outbound",
    title: "Outbound",
    description: "Configure deliverability and protect your sender reputation.",
    icon: Send,
    links: [
      {
        id: "deliverability",
        title: "Email setup and health",
        url: "/dashboard/settings/deliverability",
        permission: "deliverability:read",
        keywords: ["deliverability", "dns", "spf", "dkim", "dmarc"],
      },
      {
        id: "mailboxes",
        title: "Mailboxes",
        url: "/dashboard/mailboxes",
        permission: "mailbox:read",
        keywords: ["smtp", "inbox", "email account"],
      },
      {
        id: "sending-protection",
        title: "Sending protection",
        url: "/dashboard/settings/deliverability/sending-protection",
        permission: "deliverability:read",
        keywords: ["bounce guard", "limits", "policies"],
      },
      {
        id: "schedules",
        title: "Sequence defaults & schedules",
        url: "/dashboard/settings/schedules",
        permission: "sequence:read",
        keywords: ["sending window", "business hours"],
      },
      {
        id: "templates",
        title: "Snippets & templates",
        url: "/dashboard/settings/templates",
        permission: "template:read",
        keywords: ["email templates", "snippets"],
      },
    ],
  },
  {
    id: "data",
    title: "Data management",
    description: "Customise stages, pipelines and fields, and handle imports and opt-outs.",
    icon: Database,
    links: [
      {
        id: "contact-stages",
        title: "Contact fields & stages",
        url: "/dashboard/settings/contact-stages",
        permission: "stage:manage",
        keywords: ["stages", "triggers"],
      },
      {
        id: "pipelines",
        title: "Deal pipelines",
        url: "/dashboard/settings/pipelines",
        permission: "pipeline:manage",
        keywords: ["deal stages"],
      },
      {
        id: "custom-fields",
        title: "Custom fields",
        url: "/dashboard/settings/custom-fields",
        permission: "customfield:manage",
        keywords: ["fields"],
      },
      {
        id: "imports",
        title: "Imports & exports",
        url: "/dashboard/settings/imports",
        permission: "contact:import",
        keywords: ["csv", "import", "export"],
      },
      {
        id: "do-not-contact",
        title: "Do not contact",
        url: "/dashboard/settings/do-not-contact",
        permission: "suppression:read",
        keywords: ["suppression", "unsubscribe", "privacy", "removal requests"],
      },
    ],
  },
  {
    id: "icp",
    title: "Ideal customer profile",
    description: "Describe who you sell to, so search and AI drafts aim at the right people.",
    icon: Target,
    links: [
      {
        id: "personas",
        title: "Personas",
        url: "/dashboard/settings/personas",
        permission: "persona:manage",
        keywords: ["icp", "buyer"],
      },
      {
        id: "ai-context",
        title: "AI context center",
        url: "/dashboard/settings/ai-context",
        permission: "aicontext:manage",
        keywords: ["ai", "company profile"],
      },
    ],
  },
  {
    id: "white-label",
    title: "White-label",
    description: "The name, colour and hostnames people see for this workspace.",
    icon: Palette,
    links: [
      {
        id: "branding",
        title: "Branding",
        url: "/dashboard/settings/branding",
        permission: "branding:update",
        keywords: ["logo", "colour", "color", "brand"],
      },
      {
        id: "domains",
        title: "Domains",
        url: "/dashboard/settings/domains",
        permission: "domain:read",
        keywords: ["hostname", "white label", "ssl"],
      },
    ],
  },
];

/** Settings groups with only the links the role may open; empty groups are dropped. */
export function settingsFor(role: Role | null): SettingsGroup[] {
  return settingsGroups
    .map((group) => ({
      ...group,
      links: group.links.filter((link) => !link.permission || can(role, link.permission)),
    }))
    .filter((group) => group.links.length > 0);
}

/** Case-insensitive match on a link's title, group and keywords (settings search and ⌘K). */
export function matchesSettingsQuery(link: SettingsLink, group: SettingsGroup, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [link.title, group.title, ...(link.keywords ?? [])].some((text) => text.toLowerCase().includes(q));
}
