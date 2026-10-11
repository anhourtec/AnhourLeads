import Link from "next/link";

import { Eye } from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import type { HomeLayout } from "@/lib/onboarding";
import { can } from "@/lib/rbac/permissions";
import type { Actor } from "@/server/auth/actor";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import {
  dealsForFollowUp,
  emailStatsThisMonth,
  myMailboxes,
  myTaskCounts,
  recentRepliesByCategory,
  suggestedCompanies,
  suggestedPeople,
} from "@/server/services/home";
import { gettingStarted, onboardingFor } from "@/server/services/onboarding";

import { ErrorState } from "../_components/pipeline/error-state";
import { ChecklistCards } from "./_components/getting-started";
import { LayoutSwitcher } from "./_components/layout-switcher";
import { NoWorkspace } from "./_components/no-workspace";
import { SuggestedLeads } from "./_components/suggested-leads";
import {
  DealsFollowUpCard,
  EmailStatsCard,
  MailboxCard,
  RecentRepliesCard,
  TasksCard,
} from "./_components/win-and-close";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !context.workspace) return <NoWorkspace name={context.user.name} />;

  const state = await onboardingFor(actor.organizationId, context.user.id);
  const layout = state.homeLayout;
  const firstName = context.user.name.split(" ")[0] || context.user.name;

  let body: React.ReactNode;
  try {
    if (layout === "getting_started") {
      body = await gettingStartedLayout(actor, context.user.id, state.goals, context.brand.name);
    } else if (layout === "generate_pipeline") {
      body = await generatePipelineLayout(actor);
    } else {
      body = await winAndCloseLayout(actor);
    }
  } catch (error) {
    log.error("home failed to load", { component: "home", layout, error });
    body = <ErrorState />;
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 md:gap-6" data-home-layout={layout}>
      <HomeHeader layout={layout} firstName={firstName} />
      {body}
    </div>
  );
}

function HomeHeader({ layout, firstName }: { readonly layout: HomeLayout; readonly firstName: string }) {
  if (layout === "getting_started") {
    return (
      <div className="flex justify-end">
        <LayoutSwitcher current={layout} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 className="page-title">Welcome, {firstName}</h1>
      <LayoutSwitcher current={layout} />
    </div>
  );
}

async function gettingStartedLayout(actor: Actor, userId: string, goals: string[], brandName: string) {
  const checklist = await gettingStarted(actor.organizationId, userId, actor.role, goals);
  if (checklist.total === 0) return <ReadOnlyStart brandName={brandName} />;
  return (
    <section className="flex flex-col gap-5" aria-labelledby="getting-started-title">
      <div className="flex flex-col gap-1">
        <h1 id="getting-started-title" className="page-title text-3xl">
          Get started with {brandName}
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Complete these tasks to start reaching prospects and booking meetings.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Progress value={checklist.percent} className="h-2" aria-label="Getting started progress" />
        <span className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
          {checklist.completed} of {checklist.total} · {checklist.percent}%
        </span>
      </div>
      <ChecklistCards cards={checklist.cards} />
    </section>
  );
}

/** Viewers have nothing to set up: point them at what they can read. */
function ReadOnlyStart({ brandName }: { readonly brandName: string }) {
  return (
    <section className="flex flex-col gap-5" aria-labelledby="getting-started-title">
      <div className="flex flex-col gap-1">
        <h1 id="getting-started-title" className="page-title text-3xl">
          Get started with {brandName}
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          You have read-only access, so there's nothing to set up. Here's where to look around.
        </p>
      </div>
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Eye aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Browse what your team is working on</EmptyTitle>
          <EmptyDescription>People, companies, lists, sequences and deals are all open to you.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row flex-wrap justify-center">
          {[
            { href: "/dashboard/people", label: "People" },
            { href: "/dashboard/companies", label: "Companies" },
            { href: "/dashboard/lists", label: "Lists" },
            { href: "/dashboard/sequences", label: "Sequences" },
          ].map((link) => (
            <Button key={link.href} asChild size="sm" variant="outline">
              <Link prefetch={false} href={link.href}>
                {link.label}
              </Link>
            </Button>
          ))}
        </EmptyContent>
      </Empty>
    </section>
  );
}

async function generatePipelineLayout(actor: Actor) {
  const [people, companies] = await Promise.all([
    can(actor.role, "contact:read") ? suggestedPeople(actor) : Promise.resolve(null),
    can(actor.role, "company:read") ? suggestedCompanies(actor) : Promise.resolve(null),
  ]);
  return <SuggestedLeads people={people} companies={companies} />;
}

async function winAndCloseLayout(actor: Actor) {
  const [stats, replies, tasks, deals, mailboxes] = await Promise.all([
    emailStatsThisMonth(actor),
    recentRepliesByCategory(actor),
    can(actor.role, "task:read") ? myTaskCounts(actor) : Promise.resolve(null),
    can(actor.role, "deal:read") ? dealsForFollowUp(actor) : Promise.resolve(null),
    can(actor.role, "mailbox:read") ? myMailboxes(actor) : Promise.resolve(null),
  ]);
  const canConnect = can(actor.role, "mailbox:create");
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <EmailStatsCard stats={stats} canConnect={canConnect} />
      <RecentRepliesCard replies={replies} />
      {tasks ? <TasksCard counts={tasks} /> : null}
      {deals ? <DealsFollowUpCard deals={deals} /> : null}
      {mailboxes ? <MailboxCard mailboxes={mailboxes} canConnect={canConnect} /> : null}
    </div>
  );
}
