"use client";

import { useEffect } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  useSidebar,
} from "@/components/ui/sidebar";
import type { Brand } from "@/config/brand";
import type { Role } from "@/lib/rbac/permissions";
import { navFor } from "@/navigation/sidebar/sidebar-items";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import { NavMain } from "./nav-main";
import { SettingsNav } from "./settings-nav";
import { FooterNav, OnboardingHubCard, type SidebarProgress } from "./sidebar-footer-nav";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  readonly brand: Brand;
  readonly workspaceRole: Role | null;
  readonly isPlatformAdmin: boolean;
  readonly closedGroups: readonly string[];
  readonly progress: SidebarProgress | null;
}

/**
 * The app sidebar. Under /dashboard/settings it swaps to the settings sidebar (Back, search,
 * overview, setting groups), the way the settings shell works in the reference app.
 */
export function AppSidebar({
  brand,
  workspaceRole,
  isPlatformAdmin,
  closedGroups,
  progress,
  ...props
}: AppSidebarProps) {
  const path = usePathname();
  const { setOpenMobile } = useSidebar();
  // On phones the sidebar is a sheet: close it once a link has navigated.
  useEffect(() => {
    if (path) setOpenMobile(false);
  }, [path, setOpenMobile]);
  const { sidebarVariant, sidebarCollapsible, isSynced } = usePreferencesStore(
    useShallow((s) => ({
      sidebarVariant: s.values.sidebar_variant,
      sidebarCollapsible: s.values.sidebar_collapsible,
      isSynced: s.isSynced,
    })),
  );

  const variant = isSynced ? sidebarVariant : props.variant;
  const collapsible = isSynced ? sidebarCollapsible : props.collapsible;
  const inSettings = path === "/dashboard/settings" || path.startsWith("/dashboard/settings/");

  return (
    <Sidebar {...props} variant={variant} collapsible={collapsible} aria-label={inSettings ? "Settings" : "Main"}>
      {inSettings ? (
        <SettingsNav role={workspaceRole} />
      ) : (
        <>
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <Link prefetch={false} href="/dashboard/home">
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
            <NavMain groups={navFor(workspaceRole, isPlatformAdmin)} closedGroups={closedGroups} />
          </SidebarContent>
          <SidebarFooter className="gap-2 border-t">
            {progress && !progress.hubDismissed ? <OnboardingHubCard percent={progress.hubPercent} /> : null}
            <FooterNav role={workspaceRole} setupPercent={progress?.setupPercent ?? 0} />
          </SidebarFooter>
        </>
      )}
    </Sidebar>
  );
}
