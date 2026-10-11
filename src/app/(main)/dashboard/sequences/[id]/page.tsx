import type { Metadata } from "next";

import { can, ROLE_RANK } from "@/lib/rbac/permissions";
import { pageFrom, pagination } from "@/server/http/route";
import { searchMessages } from "@/server/services/emails";
import { orNotFound, pageActor } from "@/server/services/engage-context";
import { listLists } from "@/server/services/lists";
import { listMailboxes } from "@/server/services/mailboxes";
import { searchMembers } from "@/server/services/members";
import { listSchedules } from "@/server/services/schedules";
import { sequenceActivity, sequenceHealth } from "@/server/services/sequence-insights";
import { ENROLLMENT_FILTERS, getSequence, listEnrollments, sequenceStats } from "@/server/services/sequences";

import { ActivityTab } from "./_components/activity-tab";
import { ContactsTab } from "./_components/contacts-tab";
import { SequenceEditor } from "./_components/editor/sequence-editor";
import { HealthTab } from "./_components/health-tab";
import { ReadinessAlert } from "./_components/readiness-alert";
import { ReportTab } from "./_components/report-tab";
import { ReviewQueue } from "./_components/review-queue";
import { SequenceHeader } from "./_components/sequence-header";
import { SequenceTabs } from "./_components/sequence-tabs";
import { SettingsTab } from "./_components/settings-tab";
import { SEQUENCE_TABS } from "./_components/tabs";

export const metadata: Metadata = { title: "Sequence" };

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
  const one = (key: string) => (typeof search[key] === "string" ? (search[key] as string) : undefined);
  const tab = SEQUENCE_TABS.find((t) => t === one("tab")) ?? "editor";
  const status = ENROLLMENT_FILTERS.find((s) => s === one("status"));
  const q = one("q")?.slice(0, 200);
  const page = pageFrom({ page: one("page"), per_page: 25 });

  const { sequence, steps } = await orNotFound(getSequence(actor, id));
  const archived = sequence.status === "archived";
  const permissions = {
    canUpdate: can(actor.role, "sequence:update") && !archived,
    canLaunch: can(actor.role, "sequence:launch"),
    canCreate: can(actor.role, "sequence:create"),
    canDelete: can(actor.role, "sequence:delete"),
  };
  const zero = { page: 1, perPage: 50, offset: 0 };
  const [stats, enrollments, pending, attention, activity, health, mailboxes, schedules, members, lists] =
    await Promise.all([
      sequenceStats(actor, id),
      listEnrollments(actor, id, page, { status, q }),
      searchMessages(actor, { status: "pending_review", sequenceId: id }, zero),
      searchMessages(actor, { group: "failed", sequenceId: id }, { page: 1, perPage: 20, offset: 0 }),
      sequenceActivity(actor, id, 100),
      sequenceHealth(actor, id),
      listMailboxes(actor),
      listSchedules(actor),
      searchMembers(actor, {}, { page: 1, perPage: 100, offset: 0 }),
      permissions.canLaunch ? listLists(actor, { entityType: "contact" }) : Promise.resolve([]),
    ]);
  const contactsTotal = Object.entries(enrollments.counts)
    .filter(([k]) => k !== "removed" && k !== "not_sent")
    .reduce((a, [, n]) => a + n, 0);

  return (
    <div className="flex flex-col gap-4">
      <SequenceHeader
        sequence={sequence}
        lists={lists.map((l) => ({ id: l.id, name: l.name, memberCount: l.memberCount }))}
        can={permissions}
      />
      {sequence.status !== "active" && !archived && permissions.canLaunch ? (
        <ReadinessAlert sequence={sequence} stepCount={steps.length} />
      ) : null}
      <SequenceTabs
        value={tab}
        contactsCount={contactsTotal}
        panels={{
          editor: (
            <SequenceEditor sequence={sequence} steps={steps} stepStats={stats.steps} canEdit={permissions.canUpdate} />
          ),
          contacts: (
            <div className="flex flex-col gap-6">
              <ContactsTab
                sequenceId={sequence.id}
                enrollments={enrollments.enrollments}
                counts={enrollments.counts}
                status={status ?? "all"}
                pagination={pagination(page, enrollments.total)}
                stepCount={steps.length}
                canLaunch={permissions.canLaunch && !archived}
              />
              <ReviewQueue
                pending={pending.messages}
                pendingTotal={pending.total}
                attention={attention.messages}
                canLaunch={permissions.canLaunch}
                sequenceActive={sequence.status === "active"}
              />
            </div>
          ),
          activity: <ActivityTab items={activity} />,
          health: <HealthTab health={health} />,
          report: <ReportTab stats={stats} trackOpens={sequence.trackOpens} />,
          settings: (
            <SettingsTab
              sequence={sequence}
              mailboxes={mailboxes.map((m) => ({ id: m.id, email: m.email, readyToSend: m.readyToSend }))}
              schedules={schedules}
              members={members.users.map((m) => ({ id: m.id, name: m.name }))}
              canEdit={permissions.canUpdate}
              canOverrideBounceGuard={permissions.canUpdate && ROLE_RANK[actor.role] >= ROLE_RANK.manager}
            />
          ),
        }}
      />
    </div>
  );
}
