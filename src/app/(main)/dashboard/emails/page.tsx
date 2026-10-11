import Link from "next/link";

import { Activity, Inbox, Plus, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { can } from "@/lib/rbac/permissions";
import { pageFrom, pagination } from "@/server/http/route";
import {
  emailAnalytics,
  MESSAGE_GROUPS,
  type MessageGroup,
  messageGroupCounts,
  searchMessages,
} from "@/server/services/emails";
import { pageActor } from "@/server/services/engage-context";
import { listMailboxes } from "@/server/services/mailboxes";
import { searchSequences } from "@/server/services/sequences";
import { listTemplates } from "@/server/services/templates";

import { PageHeader } from "../_components/pipeline/page-header";
import { LibraryManager } from "../settings/templates/_components/library-manager";
import { EmailAnalyticsView } from "./_components/email-analytics";
import { EmailsList } from "./_components/emails-list";
import { EmailsTabs } from "./_components/emails-tabs";

export const metadata: Metadata = { title: "Emails" };

const TABS = ["emails", "templates", "analytics"] as const;
type Tab = (typeof TABS)[number];

export default async function EmailsPage({ searchParams }: PageProps<"/dashboard/emails">) {
  const { actor } = await pageActor("sequence:read");
  const sp = await searchParams;
  const one = (key: string) => {
    const v = sp[key];
    return typeof v === "string" && v ? v : undefined;
  };
  const tab: Tab = TABS.find((t) => t === one("tab")) ?? "emails";
  const mailboxes = await listMailboxes(actor);
  const mailboxId = mailboxes.find((m) => m.id === one("mailbox"))?.id;
  const noReadyMailbox = !mailboxes.some((m) => m.readyToSend);
  const canLaunch = can(actor.role, "sequence:launch");

  let body: React.ReactNode = null;
  if (tab === "emails") {
    const group = MESSAGE_GROUPS.find((g) => g === one("status")) as MessageGroup | undefined;
    const filters = {
      group,
      mailboxId,
      q: one("q")?.slice(0, 200),
      sequenceId: one("sequence"),
      oneOff: one("oneOff") === "true" ? true : undefined,
    };
    const page = pageFrom({ page: one("page"), per_page: 25 });
    const [result, counts, sequences] = await Promise.all([
      searchMessages(actor, filters, page),
      messageGroupCounts(actor, filters),
      searchSequences(actor, {}, { page: 1, perPage: 100, offset: 0 }),
    ]);
    const total = Object.values(counts).reduce((a, n) => a + n, 0);
    body = (
      <EmailsList
        messages={result.messages}
        counts={counts}
        allCount={total}
        pagination={pagination(page, result.total)}
        mailboxes={mailboxes.map((m) => ({ id: m.id, email: m.email }))}
        sequences={sequences.sequences.map((s) => ({ id: s.id, name: s.name }))}
        canLaunch={canLaunch}
        filtered={[group, mailboxId, filters.q, filters.sequenceId, filters.oneOff].some(Boolean)}
        now={new Date().toISOString()}
      />
    );
  } else if (tab === "templates") {
    const templates = await listTemplates(actor);
    body = (
      <LibraryManager
        kind="template"
        items={templates}
        access={{
          canCreate: can(actor.role, "template:create"),
          canUpdate: can(actor.role, "template:update"),
          canDeleteAny: can(actor.role, "template:delete"),
          currentUserId: actor.userId,
        }}
      />
    );
  } else {
    const analytics = await emailAnalytics(actor, { days: one("days") ?? 30, mailboxId });
    body = (
      <EmailAnalyticsView analytics={analytics} mailboxes={mailboxes.map((m) => ({ id: m.id, email: m.email }))} />
    );
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Emails"
        actions={
          <>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/mailboxes">
                <Inbox data-icon="inline-start" aria-hidden="true" />
                Manage mailboxes
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/settings/deliverability">
                <Activity data-icon="inline-start" aria-hidden="true" />
                Deliverability stats
              </Link>
            </Button>
            {canLaunch ? (
              <Button asChild size="sm">
                <Link href="/dashboard/emails/new">
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  New email
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {noReadyMailbox ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-800 text-sm dark:text-amber-300"
        >
          <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            You have no mailbox ready to send. Connect one to send and track emails here.
          </span>
          <Link href="/dashboard/mailboxes?new=1" className="font-medium underline underline-offset-4">
            Link mailbox
          </Link>
        </div>
      ) : null}
      <EmailsTabs value={tab} />
      {body}
    </div>
  );
}
