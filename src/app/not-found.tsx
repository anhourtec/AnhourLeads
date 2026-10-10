import Link from "next/link";

import { ArrowLeft, Radar } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getRequestBrand } from "@/server/auth/context";

export default async function NotFound() {
  const brand = await getRequestBrand();
  return (
    <main className="flex min-h-dvh flex-col bg-background px-4 py-6 sm:px-10">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Radar className="size-4" aria-hidden="true" />
        </span>
        <span className="font-semibold">{brand.name}</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
        <div className="flex flex-col gap-1.5">
          <p className="font-mono text-muted-foreground text-xs tabular-nums">404</p>
          <h1 className="font-medium text-2xl tracking-tight">Page not found</h1>
          <p className="max-w-prose text-muted-foreground text-sm">
            This page doesn't exist, or you don't have access to it. Check the address or go back to your overview.
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/dashboard/overview">
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Go to overview
          </Link>
        </Button>
      </div>
    </main>
  );
}
