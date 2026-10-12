import type { ReactNode } from "react";

import { Radar } from "lucide-react";

import { getTenantBrand } from "@/server/auth/context";

export default async function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { brand } = await getTenantBrand();
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Radar className="size-4" aria-hidden="true" />
          </span>
          <span className="font-semibold">{brand.name}</span>
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        {brand.supportEmail && (
          <p className="text-muted-foreground text-xs">
            Need help?{" "}
            <a className="underline underline-offset-4" href={`mailto:${brand.supportEmail}`}>
              {brand.supportEmail}
            </a>
          </p>
        )}
      </div>
      <div className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-end lg:p-12">
        <div className="max-w-md space-y-3">
          <p className="font-medium text-3xl leading-tight">Know who to talk to. Reach them well.</p>
          <p className="text-primary-foreground/80 text-sm">
            Find and enrich prospects, verify emails and run outreach from mailboxes you own. Every data point shows
            where it came from.
          </p>
        </div>
      </div>
    </main>
  );
}
