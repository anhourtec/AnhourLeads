"use client";

import { useTransition } from "react";

import { useRouter } from "next/navigation";

import { Check, ChevronsUpDown } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth-client";
import { ROLE_LABELS, type Role } from "@/lib/rbac/permissions";

interface WorkspaceOption {
  readonly organizationId: string;
  readonly name: string;
  readonly role: Role;
}

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  locked,
}: {
  readonly workspaces: readonly WorkspaceOption[];
  readonly activeId: string | null;
  /** On a workspace's own hostname the workspace is fixed. */
  readonly locked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = workspaces.find((w) => w.organizationId === activeId);

  if (!active) return null;

  if (locked || workspaces.length < 2) {
    return (
      <div className="hidden min-w-0 items-center gap-2 text-sm sm:flex">
        <span className="max-w-40 truncate font-medium">{active.name}</span>
        <span className="text-muted-foreground text-xs">{ROLE_LABELS[active.role]}</span>
      </div>
    );
  }

  function switchTo(organizationId: string) {
    startTransition(async () => {
      const { error } = await authClient.organization.setActive({ organizationId });
      if (error) {
        toast.error("Couldn't switch workspace. Try again.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={pending} aria-label="Switch workspace" className="max-w-56">
          <span className="truncate">{active.name}</span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.organizationId} onSelect={() => switchTo(w.organizationId)}>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{w.name}</span>
                <span className="text-muted-foreground text-xs">{ROLE_LABELS[w.role]}</span>
              </div>
              {w.organizationId === activeId && <Check aria-hidden="true" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
