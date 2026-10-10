"use client";

import Link from "next/link";

import { Radar } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { Brand } from "@/config/brand";
import type { Role } from "@/lib/rbac/permissions";
import { navFor } from "@/navigation/sidebar/sidebar-items";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import { NavMain } from "./nav-main";
import { NavUser } from "./nav-user";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  readonly brand: Brand;
  readonly workspaceRole: Role | null;
  readonly isPlatformAdmin: boolean;
  readonly user: { readonly name: string; readonly email: string; readonly image: string | null };
}

export function AppSidebar({ brand, workspaceRole, isPlatformAdmin, user, ...props }: AppSidebarProps) {
  const { sidebarVariant, sidebarCollapsible, isSynced } = usePreferencesStore(
    useShallow((s) => ({
      sidebarVariant: s.values.sidebar_variant,
      sidebarCollapsible: s.values.sidebar_collapsible,
      isSynced: s.isSynced,
    })),
  );

  const variant = isSynced ? sidebarVariant : props.variant;
  const collapsible = isSynced ? sidebarCollapsible : props.collapsible;

  return (
    <Sidebar {...props} variant={variant} collapsible={collapsible}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link prefetch={false} href="/dashboard/overview">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Radar className="size-4" aria-hidden="true" />
                </span>
                <span className="truncate font-semibold text-base">{brand.name}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navFor(workspaceRole, isPlatformAdmin)} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={{ name: user.name, email: user.email, avatar: user.image ?? "" }} />
      </SidebarFooter>
    </Sidebar>
  );
}
