import Link from "next/link";

import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { pageFrom, pagination } from "@/server/http/route";
import { orNotFound, pageActor } from "@/server/services/engage-context";
import { listMailboxes } from "@/server/services/mailboxes";
import { searchMessages } from "@/server/services/sending";
import { getSequence, listEnrollments, sequenceStats } from "@/server/services/sequences";

import { SequenceStatusPill } from "../../_components/engage/tone-pill";
import { PageHeader } from "../../_components/records/page-header";
import { EnrolledTab } from "./_components/enrolled-tab";
import { LifecycleActions } from "./_components/lifecycle-actions";
import { ReadinessAlert } from "./_components/readiness-alert";
import { ReviewQueue } from "./_components/review-queue";
import { SequenceTabs } from "./_components/sequence-tabs";
import { SettingsForm } from "./_components/settings-form";
import { StatsRow } from "./_components/stats-row";
import { StepsEditor } from "./_components/steps-editor";

export const metadata: Metadata = { title: "Sequence" };

const TABS = ["steps", "enrolled", "review", "settings"] as const;
type Tab = (typeof TABS)[number];

export default async function SequencePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await pageActor("sequence:read");
  const { id } = await params;
  const search = await searchParams;
  const tab: Tab = TABS.find((t) => t === search.tab) ?? "steps";
  const page = pageFrom({ page: search.page, per_page: 25 });

  const { sequence, steps } = await orNotFound(getSequence(actor, id));
  const canUpdate = can(actor.role, "sequence:update") && sequence.status !== "archived";
  const canLaunch = can(actor.role, "sequence:launch");
  const [stats, enrollments, pending, problems, mailboxes] = await Promise.all([
    sequenceStats(actor, id),
    listEnrollments(actor, id, page, {}),
    searchMessages(actor, { status: "pending_review", sequenceId: id }, { page: 1, perPage: 50, offset: 0 }),
    Promise.all([
      searchMessages(actor, { status: "failed", sequenceId: id }, { page: 1, perPage: 20, offset: 0 }),
      searchMessages(actor, { status: "blocked", sequenceId: id }, { page: 1, perPage: 20, offset: 0 }),
    ]),
    canUpdate ? listMailboxes(actor) : Promise.resolve([]),
  ]);
  const attention = [...problems[0].messages, ...problems[1].messages].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-2">
        <Link
          href="/dashboard/sequences"
          className="inline-flex w-fit items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Sequences
        </Link>
        <PageHeader
          title={<span className="break-words">{sequence.name}</span>}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <SequenceStatusPill status={sequence.status} />
              <span className="min-w-0 truncate font-mono text-xs">
                {sequence.mailbox ? sequence.mailbox.email : "No mailbox"}
              </span>
            </span>
          }
          actions={
            <LifecycleActions
              sequenceId={sequence.id}
              sequenceName={sequence.name}
              status={sequence.status}
              canLaunch={canLaunch}
              canDelete={can(actor.role, "sequence:delete")}
            />
          }
        />
      </div>
      {sequence.status !== "active" && sequence.status !== "archived" ? (
        <ReadinessAlert sequence={sequence} stepCount={steps.length} />
      ) : null}
      <StatsRow stats={stats} />
      <SequenceTabs
        value={tab}
        counts={{ steps: steps.length, enrolled: enrollments.total, review: pending.total }}
        steps={<StepsEditor sequenceId={sequence.id} steps={steps} stepStats={stats.steps} canEdit={canUpdate} />}
        enrolled={
          <EnrolledTab
            sequenceId={sequence.id}
            enrollments={enrollments.enrollments}
            pagination={pagination(page, enrollments.total)}
            stepCount={steps.length}
            canLaunch={canLaunch && sequence.status !== "archived"}
          />
        }
        review={
          <ReviewQueue
            pending={pending.messages}
            pendingTotal={pending.total}
            attention={attention}
            canLaunch={canLaunch}
            sequenceActive={sequence.status === "active"}
          />
        }
        settings={<SettingsForm sequence={sequence} mailboxes={mailboxes} canEdit={canUpdate} />}
      />
    </div>
  );
}
