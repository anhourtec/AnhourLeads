import { readJson, route } from "@/server/http/route";
import { deleteMailbox, getMailbox, updateMailbox } from "@/server/services/mailboxes";

type P = { id: string };

export const GET = route<P>(async ({ actor, params }) => ({ email_account: await getMailbox(actor, params.id) }), {
  permission: "mailbox:read",
});

/** Update settings. `smtpPassword` is write-only: omit it to keep the stored one. */
export const PATCH = route<P>(
  async ({ req, actor, params }) => ({ email_account: await updateMailbox(actor, params.id, await readJson(req)) }),
  { permission: "mailbox:update" },
);

export const DELETE = route<P>(
  async ({ actor, params }) => {
    await deleteMailbox(actor, params.id);
    return { deleted: true };
  },
  { permission: "mailbox:delete" },
);
