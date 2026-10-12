"use client";

import { useRouter } from "next/navigation";

import { toast } from "sonner";

import { apiRequest } from "../../_components/records/api-client";
import { ConfirmDeleteDialog } from "../../_components/records/confirm-delete-dialog";
import { MailboxDialog } from "./mailbox-dialog";
import { TestConnectionButton } from "./test-connection-button";
import type { Mailbox } from "./types";

export function MailboxActions({
  mailbox,
  canUpdate,
  canDelete,
}: {
  mailbox: Mailbox;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  return (
    <>
      {canUpdate ? <TestConnectionButton mailboxId={mailbox.id} disabled={!mailbox.smtpHost} /> : null}
      {canUpdate ? <MailboxDialog mode="edit" mailbox={mailbox} /> : null}
      {canDelete ? (
        <ConfirmDeleteDialog
          title="Remove this mailbox?"
          description={`Sequences stop sending from ${mailbox.email}. Its sent-message history is kept.`}
          triggerLabel="Remove"
          confirmLabel="Remove"
          onConfirm={async () => {
            const result = await apiRequest(`/api/v1/email_accounts/${mailbox.id}`, { method: "DELETE" });
            if (!result.ok) return result.error;
            toast.success("Mailbox removed.");
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </>
  );
}
