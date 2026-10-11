import {
  Bookmark,
  CircleDollarSign,
  House,
  LogIn,
  type LucideIcon,
  Phone,
  Search,
  Send,
  ServerCog,
  Sparkles,
  Workflow,
} from "lucide-react";

import { can, type Permission, type Role } from "@/lib/rbac/permissions";

export type NavBadge = "new" | "soon";

export interface NavSubItem {
  id: string;
  permission?: Permission;
  title: string;
  url: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

interface NavItemBase {
  id: string;
  /** Hidden unless the viewer's workspace role holds this permission. */
  permission?: Permission;
  /** Shown only to platform administrators. */
  platformOnly?: boolean;
  title: string;
  icon?: LucideIcon;
  badge?: NavBadge;
  disabled?: boolean;
  newTab?: boolean;
}

/** A small icon button on the right of a top-level link (Home's calls shortcut). */
export interface NavShortcut {
  title: string;
  url: string;
  icon: LucideIcon;
  permission?: Permission;
}

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  shortcut?: NavShortcut;
  subItems?: never;
}

/** A collapsible group: icon, label and chevron, with its links indented below. */
export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

/** Cookie holding the ids of collapsed sidebar groups, read on the server so the first paint matches. */
export const NAV_GROUPS_COOKIE = "nav_groups_closed";

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    items: [
      {
        id: "home",
        title: "Home",
        url: "/dashboard/home",
        icon: House,
        shortcut: { title: "Calls", url: "/dashboard/calls", icon: Phone, permission: "task:read" },
      },
      { id: "assistant", title: "AI Assistant", url: "/dashboard/assistant", icon: Sparkles, permission: "ai:use" },
    ],
  },
  {
    id: 2,
    items: [
      {
        id: "prospect",
        title: "Prospect and enrich",
        icon: Search,
        subItems: [
          { id: "people", title: "People", url: "/dashboard/people", permission: "contact:read" },
          { id: "companies", title: "Companies", url: "/dashboard/companies", permission: "company:read" },
          { id: "lists", title: "Lists", url: "/dashboard/lists", permission: "list:read" },
          { id: "enrichment", title: "Data enrichment", url: "/dashboard/enrichment", permission: "contact:read" },
          { id: "research", title: "Research", url: "/dashboard/research", permission: "crawler:read" },
        ],
      },
      {
        id: "engage",
        title: "Engage",
        icon: Send,
        subItems: [
          { id: "sequences", title: "Sequences", url: "/dashboard/sequences", permission: "sequence:read" },
          { id: "emails", title: "Emails", url: "/dashboard/emails", permission: "sequence:read" },
          { id: "calls", title: "Calls", url: "/dashboard/calls", permission: "task:read" },
          { id: "tasks", title: "Tasks", url: "/dashboard/tasks", permission: "task:read" },
        ],
      },
      {
        id: "win",
        title: "Win deals",
        icon: CircleDollarSign,
        subItems: [
          { id: "meetings", title: "Meetings", url: "/dashboard/meetings", permission: "contact:read" },
          { id: "conversations", title: "Conversations", url: "/dashboard/conversations", permission: "contact:read" },
          { id: "deals", title: "Deals", url: "/dashboard/deals", permission: "deal:read" },
        ],
      },
      {
        id: "tools",
        title: "Tools and automation",
        icon: Workflow,
        subItems: [
          { id: "workflows", title: "Workflows", url: "/dashboard/workflows", permission: "workflow:read" },
          { id: "analytics", title: "Analytics", url: "/dashboard/analytics", permission: "analytics:read" },
        ],
      },
      {
        id: "inbound",
        title: "Inbound",
        icon: LogIn,
        subItems: [
          {
            id: "website-visitors",
            title: "Website visitors",
            url: "/dashboard/website-visitors",
            permission: "company:read",
          },
          { id: "forms", title: "Forms", url: "/dashboard/forms", permission: "contact:read" },
        ],
      },
      {
        id: "saved",
        title: "Saved records",
        icon: Bookmark,
        subItems: [
          { id: "saved-people", title: "People", url: "/dashboard/saved/people", permission: "contact:read" },
          { id: "saved-companies", title: "Companies", url: "/dashboard/saved/companies", permission: "company:read" },
        ],
      },
    ],
  },
  {
    id: 3,
    items: [{ id: "platform", title: "Platform", url: "/dashboard/platform", icon: ServerCog, platformOnly: true }],
  },
];

/** Navigation filtered to what a role (and platform administrators) may open. */
export function navFor(role: Role | null, isPlatformAdmin: boolean): NavGroup[] {
  const allowed = (p?: Permission) => !p || can(role, p);
  return sidebarItems
    .map((group) => ({
      ...group,
      items: group.items.flatMap((item): NavMainItem[] => {
        if (item.platformOnly && !isPlatformAdmin) return [];
        if (!allowed(item.permission)) return [];
        if (!item.subItems) {
          if (item.shortcut && !allowed(item.shortcut.permission)) return [{ ...item, shortcut: undefined }];
          return [item];
        }
        const subItems = item.subItems.filter((sub) => allowed(sub.permission));
        return subItems.length ? [{ ...item, subItems }] : [];
      }),
    }))
    .filter((group) => group.items.length > 0);
}
