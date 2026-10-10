import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { getAppContext } from "@/server/auth/context";
import { MAX_HOSTNAME_LIMIT } from "@/server/domains/hostname";
import { listWorkspaces } from "@/server/services/platform";

import { WorkspacesTable } from "./_components/workspaces-table";

export const metadata: Metadata = { title: "Platform" };

export default async function PlatformPage() {
  const { user } = await getAppContext();
  if (!user.isPlatformAdmin) notFound();
  const workspaces = await listWorkspaces();

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="space-y-1">
        <h1 className="font-medium text-2xl tracking-tight">Platform</h1>
        <p className="max-w-prose text-muted-foreground text-sm">
          Every workspace on this installation. Set how many custom hostnames each one may use.
        </p>
      </div>
      <WorkspacesTable initial={workspaces} maxLimit={MAX_HOSTNAME_LIMIT} />
    </div>
  );
}
