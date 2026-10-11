"use client";

import { useState, useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Bell, Building2, Check, CircleUser, LogOut, Monitor, Moon, SlidersHorizontal, Sun } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import type { ThemeMode } from "@/lib/preferences/theme";
import { ROLE_LABELS, type Role } from "@/lib/rbac/permissions";
import { getInitials } from "@/lib/utils";
import { usePreferencesStore } from "@/stores/preferences/preferences-provider";

import { DisplayPreferences } from "./layout-controls";

interface WorkspaceOption {
  readonly organizationId: string;
  readonly name: string;
  readonly role: Role;
}

interface UserMenuProps {
  readonly user: { readonly name: string; readonly email: string; readonly image: string | null };
  readonly workspaces: readonly WorkspaceOption[];
  readonly activeId: string | null;
  /** On a workspace's own hostname the workspace is fixed. */
  readonly locked: boolean;
}

const THEMES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** Avatar menu: profile, notification settings, workspace, theme, display preferences, sign out. */
export function UserMenu({ user, workspaces, activeId, locked }: UserMenuProps) {
  const router = useRouter();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const { themeMode, setPreference } = usePreferencesStore(
    useShallow((state) => ({ themeMode: state.values.theme_mode, setPreference: state.setPreference })),
  );
  const active = workspaces.find((w) => w.organizationId === activeId);
  const canSwitch = !locked && workspaces.length > 1;

  function switchTo(organizationId: string) {
    if (organizationId === activeId) return;
    startTransition(async () => {
      const { error } = await authClient.organization.setActive({ organizationId });
      if (error) {
        toast.error("Couldn't switch workspace. Try again.");
        return;
      }
      router.push("/dashboard/home");
      router.refresh();
    });
  }

  async function signOut() {
    await authClient.signOut();
    router.replace("/auth/login");
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={`Account menu for ${user.name}`}
            disabled={pending}
          >
            <Avatar className="size-8">
              <AvatarImage src={user.image ?? undefined} alt="" />
              <AvatarFallback className="bg-primary/10 font-medium text-primary text-xs">
                {getInitials(user.name)}
              </AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={6} className="w-64">
          <DropdownMenuLabel className="font-normal">
            <div className="flex flex-col gap-0.5">
              <span className="truncate font-medium text-sm">{user.name}</span>
              <span className="truncate font-mono text-muted-foreground text-xs">{user.email}</span>
              {active ? (
                <span className="truncate text-muted-foreground text-xs">
                  {ROLE_LABELS[active.role]} in {active.name}
                </span>
              ) : null}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link prefetch={false} href="/dashboard/settings/profile">
                <CircleUser aria-hidden="true" />
                Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link prefetch={false} href="/dashboard/settings/notifications">
                <Bell aria-hidden="true" />
                Notification settings
              </Link>
            </DropdownMenuItem>
            {canSwitch ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Building2 aria-hidden="true" />
                  Switch workspace
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-60">
                  {workspaces.map((w) => (
                    <DropdownMenuItem key={w.organizationId} onSelect={() => switchTo(w.organizationId)}>
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{w.name}</span>
                        <span className="text-muted-foreground text-xs">{ROLE_LABELS[w.role]}</span>
                      </div>
                      {w.organizationId === activeId ? <Check aria-hidden="true" /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Sun aria-hidden="true" />
                Theme
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={themeMode}
                  onValueChange={(value) => setPreference("theme_mode", value as ThemeMode)}
                >
                  {THEMES.map((t) => (
                    <DropdownMenuRadioItem key={t.value} value={t.value}>
                      <t.icon aria-hidden="true" />
                      {t.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              // Open after the menu has closed and released focus, so the dialog takes it cleanly.
              onSelect={() => window.setTimeout(() => setPrefsOpen(true), 0)}
            >
              <SlidersHorizontal aria-hidden="true" />
              Display preferences
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={signOut}>
            <LogOut aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={prefsOpen} onOpenChange={setPrefsOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-sm">
          <DialogHeader className="sr-only">
            <DialogTitle>Display preferences</DialogTitle>
            <DialogDescription>How the app looks for you on this device.</DialogDescription>
          </DialogHeader>
          <DisplayPreferences />
        </DialogContent>
      </Dialog>
    </>
  );
}
