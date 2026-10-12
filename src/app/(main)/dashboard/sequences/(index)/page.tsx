import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { pageFrom, pagination } from "@/server/http/route";
import { antiSpamState } from "@/server/services/consents";
import { pageActor } from "@/server/services/engage-context";
import { listMailboxes } from "@/server/services/mailboxes";
import { searchMembers } from "@/server/services/members";
import { listSchedules } from "@/server/services/schedules";
import { sequenceAnalytics, sequenceDiagnostics } from "@/server/services/sequence-insights";
import { searchSequences, sequenceTags } from "@/server/services/sequences";

import { PageHeader } from "../../_components/records/page-header";
import { RecordsPagination } from "../../_components/records/records-pagination";
import { AnalyticsTab } from "../_components/analytics-tab";
import { BounceGuardBanner, NoMailboxBar } from "../_components/banners";
import { CreateFlowProvider, CreateSequenceButton } from "../_components/create-flow";
import { DiagnosticsTab } from "../_components/diagnostics-tab";
import { EmptyHero } from "../_components/empty-hero";
import { type ListTab, ListTabs } from "../_components/list-tabs";
import { ListToolbar } from "../_components/list-toolbar";
import { SequencesTable } from "../_components/sequences-table";

export const metadata: Metadata = { title: "Sequences" };

const STATUSES = ["draft", "active", "paused", "archived"] as const;
const TABS: ListTab[] = ["all", "analytics", "diagnostics"];

export default async function SequencesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await pageActor("sequence:read");
  const search = await searchParams;
  const one = (key: string) => (typeof search[key] === "string" ? (search[key] as string) : undefined);
  const tab = TABS.find((t) => t === one("tab")) ?? "all";
  const q = one("q")?.slice(0, 200);
  const status = STATUSES.find((s) => s === one("status"));
  const ownerId = one("owner")?.slice(0, 100);
  const tag = one("tag")?.slice(0, 40);
  const starred = one("starred") === "true" ? true : undefined;
  const filtered = Boolean(q || status || ownerId || tag || starred);
  const page = pageFrom({ page: one("page"), per_page: 25 });

  const canCreate = can(actor.role, "sequence:create");
  const [list, mailboxes, schedules, members, tags, consent, workspaceTotal] = await Promise.all([
    searchSequences(actor, { q, status, ownerId, tag, starred }, page),
    listMailboxes(actor),
    canCreate ? listSchedules(actor) : Promise.resolve([]),
    searchMembers(actor, {}, { page: 1, perPage: 100, offset: 0 }),
    sequenceTags(actor),
    antiSpamState(actor),
    filtered ? searchSequences(actor, {}, { page: 1, perPage: 1, offset: 0 }).then((r) => r.total) : null,
  ]);
  const total = workspaceTotal ?? list.total;
  const [analytics, diagnostics] = await Promise.all([
    tab === "analytics" ? sequenceAnalytics(actor) : Promise.resolve(null),
    tab === "diagnostics" ? sequenceDiagnostics(actor) : Promise.resolve(null),
  ]);
  const noMailbox = !mailboxes.some((m) => m.readyToSend);

  return (
    <CreateFlowProvider
      antiSpamRequired={consent.required}
      schedules={schedules}
      mailboxes={mailboxes.map((m) => ({ id: m.id, email: m.email, readyToSend: m.readyToSend }))}
    >
      <div className="flex flex-col gap-4">
        <PageHeader title="Sequences" actions={canCreate ? <CreateSequenceButton /> : null} />
        <ListTabs value={tab} issues={diagnostics ? diagnostics.length : null} />
        <BounceGuardBanner />
        {noMailbox ? <NoMailboxBar canLink={can(actor.role, "mailbox:create")} /> : null}
        {tab === "analytics" && analytics ? <AnalyticsTab rows={analytics} /> : null}
        {tab === "diagnostics" && diagnostics ? <DiagnosticsTab rows={diagnostics} /> : null}
        {tab === "all" && total === 0 ? <EmptyHero canCreate={canCreate} /> : null}
        {tab === "all" && total > 0 ? (
          <div className="flex flex-col gap-3">
            <ListToolbar owners={members.users.map((m) => ({ id: m.id, name: m.name }))} tags={tags} />
            {list.sequences.length ? (
              <SequencesTable
                sequences={list.sequences}
                canUpdate={can(actor.role, "sequence:update")}
                canLaunch={can(actor.role, "sequence:launch")}
              />
            ) : (
              <p className="rounded-xl border px-4 py-10 text-center text-muted-foreground text-sm">
                No sequences match these filters.
              </p>
            )}
            {list.total > 0 ? <RecordsPagination pagination={pagination(page, list.total)} noun="sequences" /> : null}
          </div>
        ) : null}
      </div>
    </CreateFlowProvider>
  );
}
