"use client";

import { useState, useTransition } from "react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import {
  Activity,
  ChevronRight,
  Gauge,
  HeartPulse,
  type LucideIcon,
  Plug,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { can, type Permission, type Role } from "@/lib/rbac/permissions";

import { isPathActive } from "./nav-main";

export interface SidebarProgress {
  /** Getting-started checklist completion for the signed-in person, 0–100. */
  hubPercent: number;
  hubDismissed: boolean;
  /** Workspace setup completion (teammates, mailbox, brand, hostname, opt-outs), 0–100. */
  setupPercent: number;
}

/** The onboarding hub card above the footer links: progress, link to the hub, dismiss. */
export function OnboardingHubCard({ percent }: { readonly percent: number }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();

  if (hidden) return null;

  function dismiss() {
    setHidden(true);
    startTransition(async () => {
      const res = await fetch("/api/v1/onboarding", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hubDismissed: true }),
      }).catch(() => null);
      if (!res?.ok) {
        setHidden(false);
        toast.error("Couldn't hide the onboarding hub. Try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div
      className="relative rounded-lg border bg-background p-3 group-data-[collapsible=icon]:hidden"
      data-testid="onboarding-hub-card"
    >
      <Link
        prefetch={false}
        href="/dashboard/onboarding-hub"
        className="block rounded-sm pr-6 outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="font-medium text-sm">Onboarding hub</span>
        <Progress value={percent} className="mt-2 h-1.5" aria-label="Onboarding progress" />
        <span className="mt-1.5 block font-mono text-muted-foreground text-xs tabular-nums">{percent}% completed</span>
      </Link>
      <button
        type="button"
        onClick={dismiss}
        disabled={pending}
        aria-label="Hide onboarding hub"
        className="absolute top-2 right-2 rounded-sm p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

interface AdminLink {
  id: string;
  title: string;
  href: string;
  icon: LucideIcon;
  permission?: Permission;
}

const ADMIN_LINKS: AdminLink[] = [
  {
    id: "audit",
    title: "System activity",
    href: "/dashboard/settings/audit-log",
    icon: Activity,
    permission: "audit:read",
  },
  { id: "security", title: "Security", href: "/dashboard/settings/profile", icon: ShieldCheck },
  { id: "usage", title: "Usage", href: "/dashboard/settings/usage", icon: Gauge },
  {
    id: "integrations",
    title: "Integrations",
    href: "/dashboard/settings/api-keys",
    icon: Plug,
    permission: "apikey:read",
  },
];

/** Footer links: "Email setup and health" and the "Admin settings" menu. */
export function FooterNav({ role, setupPercent }: { readonly role: Role | null; readonly setupPercent: number }) {
  const path = usePathname();
  const { isMobile } = useSidebar();
  const deliverability = "/dashboard/settings/deliverability";

  return (
    <SidebarMenu className="gap-0.5">
      {can(role, "deliverability:read") ? (
        <SidebarMenuItem>
          <SidebarMenuButton asChild tooltip="Email setup and health" isActive={isPathActive(path, deliverability)}>
            <Link prefetch={false} href={deliverability}>
              <HeartPulse aria-hidden="true" />
              <span>Email setup and health</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton tooltip="Admin settings" className="data-[state=open]:bg-sidebar-accent">
              <Settings aria-hidden="true" />
              <span>Admin settings</span>
              <ChevronRight aria-hidden="true" className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? "top" : "right"} align="end" sideOffset={8} className="w-72">
            <DropdownMenuLabel className="text-muted-foreground text-xs">Admin settings</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link
                  prefetch={false}
                  href="/dashboard/onboarding-hub#workspace-setup"
                  className="flex flex-col items-start gap-1.5"
                >
                  <span className="flex w-full items-center gap-2 whitespace-nowrap">
                    <SlidersHorizontal aria-hidden="true" />
                    Workspace setup
                    <span className="ml-auto whitespace-nowrap font-mono text-muted-foreground text-xs tabular-nums">
                      {setupPercent}% completed
                    </span>
                  </span>
                  <Progress value={setupPercent} className="h-1" aria-label="Workspace setup progress" />
                </Link>
              </DropdownMenuItem>
              {ADMIN_LINKS.filter((link) => !link.permission || can(role, link.permission)).map((link) => (
                <DropdownMenuItem key={link.id} asChild>
                  <Link prefetch={false} href={link.href}>
                    <link.icon aria-hidden="true" />
                    {link.title}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link prefetch={false} href="/dashboard/settings">
                <Settings aria-hidden="true" />
                All settings
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
