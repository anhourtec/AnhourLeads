import Link from "next/link";
import { notFound } from "next/navigation";

import { UserPlus } from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/rbac/permissions";
import { settingsFor } from "@/navigation/settings/settings-items";
import { getAppContext } from "@/server/auth/context";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsOverviewPage() {
  const { workspace } = await getAppContext();
  if (!workspace) notFound();
  const role = workspace.role;
  const groups = settingsFor(role);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <h1 className="page-title">Workspace settings</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {groups.map((group) => {
          const Icon = group.icon;
          return (
            <Card key={group.id} data-testid={`settings-card-${group.id}`}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <h2>{group.title}</h2>
                </CardTitle>
                <CardDescription>{group.description}</CardDescription>
                {group.id === "users" && can(role, "member:invite") ? (
                  <CardAction>
                    <Button asChild size="sm" variant="outline">
                      <Link prefetch={false} href="/dashboard/settings/members">
                        <UserPlus data-icon="inline-start" />
                        Add teammates
                      </Link>
                    </Button>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent>
                <ul className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  {group.links.map((link) => (
                    <li key={link.id}>
                      <Link
                        prefetch={false}
                        href={link.url}
                        className="rounded-sm text-primary text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {link.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
