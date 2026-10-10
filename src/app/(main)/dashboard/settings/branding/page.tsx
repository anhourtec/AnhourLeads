import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { getBranding } from "@/server/services/branding";

import { BrandingForm } from "./_components/branding-form";

export const metadata: Metadata = { title: "Branding" };

export default async function BrandingPage() {
  const { workspace } = await getAppContext();
  if (!workspace || !can(workspace.role, "branding:update")) notFound();
  const branding = await getBranding(workspace.organizationId);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="space-y-1">
        <h1 className="font-medium text-2xl tracking-tight">Branding</h1>
        <p className="max-w-prose text-muted-foreground text-sm">
          The name, colour and support email people see in this workspace, on its sign-in pages and on its own
          hostnames.
        </p>
      </div>
      <BrandingForm initial={branding} />
    </div>
  );
}
