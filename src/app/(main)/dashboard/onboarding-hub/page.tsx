import Link from "next/link";

import { Circle, CircleCheck } from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { gettingStarted, onboardingFor, workspaceSetup } from "@/server/services/onboarding";

import { ErrorState } from "../_components/pipeline/error-state";
import { PageHeader } from "../_components/pipeline/page-header";
import { ChecklistCards } from "../home/_components/getting-started";
import { NoWorkspace } from "../home/_components/no-workspace";
import { HubVisibilityButton } from "./_components/hub-visibility-button";

export const metadata: Metadata = { title: "Onboarding hub" };

export default async function OnboardingHubPage() {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !context.workspace) return <NoWorkspace name={context.user.name} />;
  const showSetup = can(actor.role, "workspace:update");

  const data = await Promise.all([
    onboardingFor(actor.organizationId, context.user.id),
    showSetup ? workspaceSetup(actor.organizationId) : Promise.resolve(null),
  ])
    .then(async ([state, setup]) => ({
      state,
      setup,
      checklist: await gettingStarted(actor.organizationId, context.user.id, actor.role, state.goals),
    }))
    .catch((error: unknown) => {
      log.error("onboarding hub failed to load", { component: "onboarding-hub", error });
      return null;
    });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 md:gap-6">
      <PageHeader
        title="Onboarding hub"
        description="Everything left to set up, checked off automatically as you go."
        actions={data ? <HubVisibilityButton dismissed={Boolean(data.state.hubDismissedAt)} /> : null}
      />
      {data ? (
        <>
          <div className="flex items-center gap-3">
            <Progress value={data.checklist.percent} className="h-2" aria-label="Your onboarding progress" />
            <span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
              {data.checklist.percent}% completed
            </span>
          </div>
          <ChecklistCards cards={data.checklist.cards} />
          {data.setup ? (
            <Card id="workspace-setup">
              <CardHeader>
                <CardTitle>Workspace setup</CardTitle>
                <CardDescription>
                  For administrators: the workspace-wide pieces, {data.setup.percent}% done.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y" aria-label="Workspace setup">
                  {data.setup.steps.map((step) => (
                    <li key={step.id} className="flex items-center justify-between gap-3 py-3">
                      <span className="flex items-center gap-2 text-sm">
                        {step.done ? (
                          <CircleCheck className="size-4 text-primary" aria-hidden="true" />
                        ) : (
                          <Circle className="size-4 text-muted-foreground" aria-hidden="true" />
                        )}
                        <span className={step.done ? "text-muted-foreground" : ""}>{step.label}</span>
                        <span className="sr-only">{step.done ? "(done)" : "(not done yet)"}</span>
                      </span>
                      <Button asChild size="sm" variant="outline">
                        <Link prefetch={false} href={step.href}>
                          {step.done ? "Review" : "Set up"}
                        </Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : (
        <ErrorState />
      )}
    </div>
  );
}
