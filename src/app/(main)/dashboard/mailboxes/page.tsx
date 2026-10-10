import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { pageActor } from "@/server/services/engage-context";
import { listMailboxes } from "@/server/services/mailboxes";

import { PageHeader } from "../_components/records/page-header";
import { MailboxDialog } from "./_components/mailbox-dialog";
import { MailboxList } from "./_components/mailbox-list";

export const metadata: Metadata = { title: "Mailboxes" };

export default async function MailboxesPage() {
  const { actor } = await pageActor("mailbox:read");
  const mailboxes = await listMailboxes(actor);
  const permissions = {
    create: can(actor.role, "mailbox:create"),
    update: can(actor.role, "mailbox:update"),
    remove: can(actor.role, "mailbox:delete"),
  };

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Mailboxes"
        description="The addresses sequences send from. Each one has a daily limit, a sending window and the sender details every message must carry."
        actions={permissions.create ? <MailboxDialog mode="create" /> : null}
      />
      <MailboxList mailboxes={mailboxes} permissions={permissions} />
    </div>
  );
}
