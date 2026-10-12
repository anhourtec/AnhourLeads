import Link from "next/link";

import { Info, type LucideIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can, type Permission, type Role } from "@/lib/rbac/permissions";

export interface FeatureBenefit {
  icon: LucideIcon;
  label: string;
  description: string;
}

export interface FeatureWorkaround {
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
}

/**
 * Honest empty state for a feature that needs third-party infrastructure this installation doesn't
 * have yet: what it will do, what it needs, and what already works today. No sample data.
 */
export function FeatureUnavailable({
  title,
  value,
  benefits,
  needs,
  workarounds,
  role,
}: {
  readonly title: string;
  readonly value: string;
  readonly benefits: readonly FeatureBenefit[];
  readonly needs: string;
  readonly workarounds: readonly FeatureWorkaround[];
  readonly role: Role | null;
}) {
  const available = workarounds.filter((w) => can(role, w.permission));
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 md:gap-8">
      <section aria-labelledby="feature-title" className="flex flex-col gap-2">
        <h1 id="feature-title" className="page-title">
          {title}
        </h1>
        <p className="max-w-prose text-muted-foreground text-sm">{value}</p>
      </section>

      <ul aria-label="What it will do" className="grid gap-3 sm:grid-cols-2">
        {benefits.map((b) => (
          <li key={b.label} className="flex min-w-0 gap-3 rounded-lg border bg-card p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
              <b.icon className="size-4" aria-hidden="true" />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium text-sm">{b.label}</span>
              <span className="text-muted-foreground text-sm">{b.description}</span>
            </span>
          </li>
        ))}
      </ul>

      <Alert>
        <Info aria-hidden="true" />
        <AlertTitle>Not available in this installation yet</AlertTitle>
        <AlertDescription>{needs}</AlertDescription>
      </Alert>

      {available.length ? (
        <Card>
          <CardHeader>
            <CardTitle>What works today</CardTitle>
            <CardDescription>You can already cover part of this with features that are here now.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y">
              {available.map((w) => (
                <li
                  key={w.href}
                  className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium text-sm">{w.label}</span>
                    <span className="text-muted-foreground text-sm">{w.description}</span>
                  </span>
                  <Button asChild size="sm" variant="outline" className="self-start sm:self-auto">
                    <Link prefetch={false} href={w.href}>
                      <w.icon data-icon="inline-start" />
                      {w.label}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
