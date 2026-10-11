import type { ReactNode } from "react";

import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { cn } from "cn";
import { Gauge, Sparkles } from "lucide-react";

import { AppSidebar } from "@/app/(main)/dashboard/_components/sidebar/app-sidebar";
import type { SidebarProgress } from "@/app/(main)/dashboard/_components/sidebar/sidebar-footer-nav";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { can } from "@/lib/rbac/permissions";
import { NAV_GROUPS_COOKIE } from "@/navigation/sidebar/sidebar-items";
import { getAppContext } from "@/server/auth/context";
import { log } from "@/server/log";
import { getPreference } from "@/server/server-actions";
import { gettingStarted, needsOnboarding, onboardingFor, workspaceSetup } from "@/server/services/onboarding";

import { CommandSearch } from "./_components/header/command-search";
import { NotificationsBell } from "./_components/header/notifications-bell";
import { UserMenu } from "./_components/header/user-menu";

async function sidebarProgress(organizationId: string, userId: string, role: Parameters<typeof gettingStarted>[2]) {
  try {
    const [checklist, state, setup] = await Promise.all([
      gettingStarted(organizationId, userId, role),
      onboardingFor(organizationId, userId),
      workspaceSetup(organizationId),
    ]);
    return {
      hubPercent: checklist.percent,
      // Roles with nothing to set up (viewers) don't get the hub card.
      hubDismissed: Boolean(state.hubDismissedAt) || checklist.total === 0,
      setupPercent: setup.percent,
    } satisfies SidebarProgress;
  } catch (error) {
    log.error("sidebar progress failed to load", { component: "shell", error });
    return null;
  }
}

export default async function Layout({ children }: Readonly<{ children: ReactNode }>) {
  const context = await getAppContext();
  const workspace = context.workspace;

  // People who joined a workspace go through onboarding first (viewers and older accounts don't).
  if (workspace && (await needsOnboarding(workspace.organizationId, context.user.id, workspace.role))) {
    redirect("/onboarding");
  }

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false";
  const closedGroups = decodeURIComponent(cookieStore.get(NAV_GROUPS_COOKIE)?.value ?? "")
    .split(",")
    .filter(Boolean);
  const [variant, collapsible, progress] = await Promise.all([
    getPreference("sidebar_variant"),
    getPreference("sidebar_collapsible"),
    workspace ? sidebarProgress(workspace.organizationId, context.user.id, workspace.role) : Promise.resolve(null),
  ]);
  const role = workspace?.role ?? null;

  return (
    <SidebarProvider
      defaultOpen={defaultOpen}
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 60)",
        } as React.CSSProperties
      }
    >
      <AppSidebar
        variant={variant}
        collapsible={collapsible}
        brand={context.brand}
        workspaceRole={role}
        isPlatformAdmin={context.user.isPlatformAdmin}
        closedGroups={closedGroups}
        progress={progress}
      />
      <SidebarInset
        className={cn(
          "[html[data-content-layout=centered]_&>*]:mx-auto",
          "[html[data-content-layout=centered]_&>*]:w-full",
          "[html[data-content-layout=centered]_&>*]:max-w-screen-2xl",
          "peer-data-[variant=inset]:border",
          "[--dashboard-header-height:--spacing(12)]",
          "min-w-0 overflow-x-clip",
        )}
      >
        <header
          className={cn(
            "flex h-12 shrink-0 items-center gap-2 border-b bg-background",
            // Sticky navbar keeps blur, background, z-index and rounded corners consistent across sidebar variants.
            "[html[data-navbar-style=sticky]_&]:sticky [html[data-navbar-style=sticky]_&]:top-0 [html[data-navbar-style=sticky]_&]:z-50 [html[data-navbar-style=sticky]_&]:rounded-t-[inherit] [html[data-navbar-style=sticky]_&]:bg-background/80 [html[data-navbar-style=sticky]_&]:backdrop-blur-md",
          )}
        >
          <div className="flex w-full min-w-0 items-center gap-2 px-3 lg:px-4">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <SidebarTrigger className="-ml-1 shrink-0" />
              <div className="flex min-w-0 flex-1 justify-center">
                {workspace && can(role, "search:run") ? <CommandSearch role={role} /> : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {workspace ? (
                <Button asChild size="sm" variant="outline" className="hidden md:inline-flex">
                  <Link prefetch={false} href="/dashboard/settings/usage">
                    <Gauge data-icon="inline-start" />
                    Usage
                  </Link>
                </Button>
              ) : null}
              {can(role, "ai:use") ? (
                <Button asChild size="sm" className="hidden sm:inline-flex">
                  <Link prefetch={false} href="/dashboard/assistant">
                    <Sparkles data-icon="inline-start" />
                    AI Assistant
                  </Link>
                </Button>
              ) : null}
              {workspace ? <NotificationsBell /> : null}
              <UserMenu
                user={context.user}
                workspaces={context.memberships}
                activeId={workspace?.organizationId ?? null}
                locked={context.tenant.kind === "workspace"}
              />
            </div>
          </div>
        </header>
        {/* Pages can set data-content-padding="false" to render full-bleed app layouts. */}
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden p-4 has-data-[content-padding=false]:p-0 md:p-6 md:has-data-[content-padding=false]:p-0">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
