"use client";

import { useState } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ChevronDown } from "lucide-react";

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { setClientCookie } from "@/lib/cookie.client";
import {
  NAV_GROUPS_COOKIE,
  type NavGroup,
  type NavMainLinkItem,
  type NavMainParentItem,
} from "@/navigation/sidebar/sidebar-items";

interface NavMainProps {
  readonly groups: readonly NavGroup[];
  /** Ids of collapsed groups, from the cookie, so the server render matches. */
  readonly closedGroups: readonly string[];
}

/** Active when the path is the link itself or a page below it. */
export function isPathActive(path: string, url: string): boolean {
  return path === url || path.startsWith(`${url}/`);
}

function persistClosed(closed: Set<string>) {
  // A year; read back by the dashboard layout on the server.
  setClientCookie(NAV_GROUPS_COOKIE, encodeURIComponent([...closed].join(",")), 365);
}

export function NavMain({ groups, closedGroups }: NavMainProps) {
  const path = usePathname();
  const [closed, setClosed] = useState(() => new Set(closedGroups));

  const setOpen = (id: string, open: boolean) => {
    setClosed((prev) => {
      const next = new Set(prev);
      if (open) next.delete(id);
      else next.add(id);
      persistClosed(next);
      return next;
    });
  };

  return (
    <>
      {groups.map((group, index) => (
        <div key={group.id} className="contents">
          {index > 0 ? <SidebarSeparator className="mx-3" /> : null}
          <SidebarGroup className="py-1">
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.items.map((item) =>
                  item.subItems ? (
                    <NavGroupItem
                      key={item.id}
                      item={item}
                      path={path}
                      open={!closed.has(item.id)}
                      onOpenChange={(open) => setOpen(item.id, open)}
                    />
                  ) : (
                    <NavLinkItem key={item.id} item={item} isActive={isPathActive(path, item.url)} />
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </div>
      ))}
    </>
  );
}

function NavLinkItem({ item, isActive }: { readonly item: NavMainLinkItem; readonly isActive: boolean }) {
  const Icon = item.icon;
  const Shortcut = item.shortcut?.icon;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild tooltip={item.title} isActive={isActive} aria-disabled={item.disabled}>
        <Link prefetch={false} href={item.url} aria-current={isActive ? "page" : undefined}>
          {Icon ? <Icon aria-hidden="true" /> : null}
          <span>{item.title}</span>
        </Link>
      </SidebarMenuButton>
      {item.shortcut && Shortcut ? (
        <SidebarMenuAction asChild className="text-muted-foreground hover:text-foreground">
          <Link prefetch={false} href={item.shortcut.url} aria-label={item.shortcut.title} title={item.shortcut.title}>
            <Shortcut aria-hidden="true" />
          </Link>
        </SidebarMenuAction>
      ) : null}
    </SidebarMenuItem>
  );
}

function NavGroupItem({
  item,
  path,
  open,
  onOpenChange,
}: {
  readonly item: NavMainParentItem;
  readonly path: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { state, isMobile } = useSidebar();
  const Icon = item.icon;
  const containsActive = item.subItems.some((sub) => isPathActive(path, sub.url));

  // Icon-only sidebar: the group opens as a menu beside the rail.
  if (state === "collapsed" && !isMobile) {
    return (
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton tooltip={item.title} isActive={containsActive}>
              {Icon ? <Icon aria-hidden="true" /> : null}
              <span>{item.title}</span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start" sideOffset={12} className="w-52">
            <DropdownMenuLabel className="text-muted-foreground text-xs">{item.title}</DropdownMenuLabel>
            <DropdownMenuGroup>
              {item.subItems.map((sub) => (
                <DropdownMenuItem key={sub.id} asChild>
                  <Link prefetch={false} href={sub.url} aria-current={isPathActive(path, sub.url) ? "page" : undefined}>
                    {sub.title}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible asChild open={open} onOpenChange={onOpenChange} className="group/collapsible">
      <SidebarMenuItem data-nav-group={item.id}>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton className="text-sidebar-foreground/80">
            {Icon ? <Icon aria-hidden="true" /> : null}
            <span>{item.title}</span>
            <ChevronDown
              aria-hidden="true"
              className="ml-auto text-muted-foreground transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180"
            />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub className="mx-0 translate-x-0 gap-0.5 border-l-0 px-0 py-0.5">
            {item.subItems.map((sub) => {
              const active = isPathActive(path, sub.url);
              return (
                <SidebarMenuSubItem key={sub.id}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={active}
                    className="h-8 translate-x-0 pl-8 data-active:font-medium"
                  >
                    <Link prefetch={false} href={sub.url} aria-current={active ? "page" : undefined}>
                      <span>{sub.title}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
