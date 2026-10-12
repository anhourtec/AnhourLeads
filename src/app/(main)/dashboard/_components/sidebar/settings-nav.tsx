"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ArrowLeft, ChevronDown, House, Search, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { can, type Role } from "@/lib/rbac/permissions";
import { matchesSettingsQuery, SETTINGS_OVERVIEW_URL, settingsFor } from "@/navigation/settings/settings-items";

import { isPathActive } from "./nav-main";

/** The settings shell's sidebar: back to the app, search, overview and collapsible setting groups. */
export function SettingsNav({ role }: { readonly role: Role | null }) {
  const path = usePathname();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => settingsFor(role), [role]);
  const filtered = useMemo(
    () =>
      groups
        .map((group) => ({ ...group, links: group.links.filter((link) => matchesSettingsQuery(link, group, query)) }))
        .filter((group) => group.links.length > 0),
    [groups, query],
  );
  // Groups start open when they hold the current page; searching opens every match.
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.links.some((l) => isPathActive(path, l.url))).map((g) => g.id)),
  );
  const toggle = (id: string, next: boolean) =>
    setOpen((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });

  return (
    <>
      <SidebarHeader className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip="Back">
              <Link prefetch={false} href="/dashboard/home">
                <ArrowLeft aria-hidden="true" />
                <span>Back</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="relative group-data-[collapsible=icon]:hidden">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <SidebarInput
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            className="h-9 pl-8"
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5">
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="Settings overview" isActive={path === SETTINGS_OVERVIEW_URL}>
                  <Link prefetch={false} href={SETTINGS_OVERVIEW_URL}>
                    <House aria-hidden="true" />
                    <span>Settings overview</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {filtered.map((group) => {
                const Icon = group.icon;
                const isOpen = query.trim() !== "" || open.has(group.id);
                return (
                  <Collapsible
                    key={group.id}
                    asChild
                    open={isOpen}
                    onOpenChange={(next) => toggle(group.id, next)}
                    className="group/collapsible"
                  >
                    <SidebarMenuItem data-settings-group={group.id}>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton tooltip={group.title} className="text-sidebar-foreground/80">
                          <Icon aria-hidden="true" />
                          <span>{group.title}</span>
                          <ChevronDown
                            aria-hidden="true"
                            className="ml-auto text-muted-foreground transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180"
                          />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub className="mx-0 translate-x-0 gap-0.5 border-l-0 px-0 py-0.5">
                          {group.links.map((link) => {
                            const active = isPathActive(path, link.url);
                            return (
                              <SidebarMenuSubItem key={link.id}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={active}
                                  className="h-8 translate-x-0 pl-8 data-active:font-medium"
                                >
                                  <Link prefetch={false} href={link.url} aria-current={active ? "page" : undefined}>
                                    <span>{link.title}</span>
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
              })}
              {filtered.length === 0 ? (
                <li className="px-2 py-3 text-muted-foreground text-sm group-data-[collapsible=icon]:hidden">
                  No settings match “{query.trim()}”.
                </li>
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {can(role, "member:invite") ? (
        <SidebarFooter className="group-data-[collapsible=icon]:hidden">
          <Button asChild size="sm" variant="outline" className="w-full">
            <Link prefetch={false} href="/dashboard/settings/members">
              <UserPlus data-icon="inline-start" />
              Add teammates
            </Link>
          </Button>
        </SidebarFooter>
      ) : null}
    </>
  );
}
