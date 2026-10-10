import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { pageFrom, pagination } from "@/server/http/route";
import { pageActor } from "@/server/services/engage-context";
import { listMailboxes } from "@/server/services/mailboxes";
import { searchSequences } from "@/server/services/sequences";

import { PageHeader } from "../_components/records/page-header";
import { RecordsPagination } from "../_components/records/records-pagination";
import { SearchBox } from "../_components/records/search-box";
import { CreateSequenceDialog } from "./_components/create-sequence-dialog";
import { SequencesTable } from "./_components/sequences-table";
import { StatusFilter } from "./_components/status-filter";

export const metadata: Metadata = { title: "Sequences" };

const STATUSES = ["draft", "active", "paused", "archived"] as const;
type Status = (typeof STATUSES)[number];

export default async function SequencesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await pageActor("sequence:read");
  const search = await searchParams;
  const q = typeof search.q === "string" ? search.q.slice(0, 200) : undefined;
  const status = STATUSES.find((s) => s === search.status) as Status | undefined;
  const page = pageFrom({ page: search.page, per_page: 25 });
  const [{ sequences, total }, mailboxes] = await Promise.all([
    searchSequences(actor, { q, status }, page),
    can(actor.role, "sequence:create") ? listMailboxes(actor) : Promise.resolve([]),
  ]);
  const canCreate = can(actor.role, "sequence:create");
  const mailboxOptions = mailboxes.map((m) => ({ id: m.id, email: m.email, readyToSend: m.readyToSend }));

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Sequences"
        description="Multi-step outreach sent from your own mailboxes, with review, sending windows and one-click unsubscribe."
        actions={canCreate ? <CreateSequenceDialog mailboxes={mailboxOptions} /> : null}
      />
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <SearchBox placeholder="Search sequences" label="Search sequences" />
          <StatusFilter />
        </div>
        <SequencesTable
          sequences={sequences}
          filtered={Boolean(q || status)}
          createAction={canCreate ? <CreateSequenceDialog mailboxes={mailboxOptions} /> : null}
        />
        {total > 0 ? <RecordsPagination pagination={pagination(page, total)} noun="sequences" /> : null}
      </div>
    </div>
  );
}
