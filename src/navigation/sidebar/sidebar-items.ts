import {
  Building2,
  CheckSquare,
  Globe,
  Handshake,
  Inbox,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Palette,
  Radar,
  ScrollText,
  Send,
  ServerCog,
  Settings,
  ShieldBan,
  Users,
  UsersRound,
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

export interface NavMainLinkItem extends NavItemBase {
  url: string;
  subItems?: never;
}

export interface NavMainParentItem extends NavItemBase {
  subItems: NavSubItem[];
}

export type NavMainItem = NavMainLinkItem | NavMainParentItem;

export interface NavGroup {
  id: number;
  label?: string;
  items: NavMainItem[];
}

export const sidebarItems: NavGroup[] = [
  {
    id: 1,
    label: "Prospect",
    items: [
      { id: "overview", title: "Overview", url: "/dashboard/overview", icon: LayoutDashboard },
      { id: "people", title: "People", url: "/dashboard/people", icon: Users, permission: "contact:read" },
      { id: "companies", title: "Companies", url: "/dashboard/companies", icon: Building2, permission: "company:read" },
      { id: "lists", title: "Lists", url: "/dashboard/lists", icon: ListChecks, permission: "list:read" },
      { id: "research", title: "Research", url: "/dashboard/research", icon: Radar, permission: "crawler:read" },
    ],
  },
  {
    id: 2,
    label: "Engage",
    items: [
      { id: "sequences", title: "Sequences", url: "/dashboard/sequences", icon: Send, permission: "sequence:read" },
      { id: "mailboxes", title: "Mailboxes", url: "/dashboard/mailboxes", icon: Inbox, permission: "mailbox:read" },
      { id: "tasks", title: "Tasks", url: "/dashboard/tasks", icon: CheckSquare, permission: "task:read" },
      { id: "deals", title: "Deals", url: "/dashboard/deals", icon: Handshake, permission: "deal:read" },
    ],
  },
  {
    id: 3,
    label: "Workspace",
    items: [
      {
        id: "settings",
        title: "Settings",
        icon: Settings,
        subItems: [
          {
            id: "members",
            title: "Members",
            url: "/dashboard/settings/members",
            icon: UsersRound,
            permission: "member:read",
          },
          {
            id: "do-not-contact",
            title: "Do not contact",
            url: "/dashboard/settings/do-not-contact",
            icon: ShieldBan,
            permission: "suppression:read",
          },
          {
            id: "api-keys",
            title: "API keys",
            url: "/dashboard/settings/api-keys",
            icon: KeyRound,
            permission: "apikey:read",
          },
          {
            id: "branding",
            title: "Branding",
            url: "/dashboard/settings/branding",
            icon: Palette,
            permission: "branding:update",
          },
          {
            id: "domains",
            title: "Domains",
            url: "/dashboard/settings/domains",
            icon: Globe,
            permission: "domain:read",
          },
          {
            id: "audit-log",
            title: "Audit log",
            url: "/dashboard/settings/audit-log",
            icon: ScrollText,
            permission: "audit:read",
          },
        ],
      },
      { id: "platform", title: "Platform", url: "/dashboard/platform", icon: ServerCog, platformOnly: true },
    ],
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
        if (!item.subItems) return [item];
        const subItems = item.subItems.filter((sub) => allowed(sub.permission));
        return subItems.length ? [{ ...item, subItems }] : [];
      }),
    }))
    .filter((group) => group.items.length > 0);
}
