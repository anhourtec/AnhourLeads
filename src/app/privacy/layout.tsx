import type { ReactNode } from "react";

import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { Radar } from "lucide-react";

import { getTenantBrand } from "@/server/auth/context";
import { requestHost, resolveTenant } from "@/server/tenancy/host";

/**
 * Public privacy pages (no sign-in). The discovery index belongs to the installation, so these
 * pages are served on its own hostnames only; workspace hostnames answer 404.
 */
export default async function PrivacyLayout({ children }: Readonly<{ children: ReactNode }>) {
  const tenant = await resolveTenant(requestHost(await headers()));
  if (!tenant || tenant.kind !== "primary") notFound();
  const { brand } = await getTenantBrand();
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-2 px-4">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Radar className="size-4" aria-hidden="true" />
          </span>
          <span className="font-semibold">{brand.name}</span>
          <span className="text-muted-foreground text-sm">· Privacy</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:py-12">{children}</main>
    </div>
  );
}
