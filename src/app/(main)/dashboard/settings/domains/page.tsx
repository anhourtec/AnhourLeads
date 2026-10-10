import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { env } from "@/server/env";
import { listDomains } from "@/server/services/domains";

import { DomainsManager } from "./_components/domains-manager";

export const metadata: Metadata = { title: "Domains" };

export default async function DomainsPage() {
  const { workspace } = await getAppContext();
  if (!workspace || !can(workspace.role, "domain:read")) notFound();
  const view = await listDomains(workspace.organizationId);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="space-y-1">
        <h1 className="font-medium text-2xl tracking-tight">Domains</h1>
        <p className="max-w-prose text-muted-foreground text-sm">
          Serve this workspace on your own hostname, such as portal.example.com. People who open it see your brand,
          never the installation's.
        </p>
      </div>
      <DomainsManager initial={view} canManage={can(workspace.role, "domain:manage")} protocol={env().APP_PROTOCOL} />
    </div>
  );
}
