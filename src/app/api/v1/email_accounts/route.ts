import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createMailbox, listMailboxes } from "@/server/services/mailboxes";

/** Connected mailboxes (Apollo: GET /email_accounts). Passwords are never returned. */
export const GET = route(async ({ actor }) => ({ email_accounts: await listMailboxes(actor) }), {
  permission: "mailbox:read",
});

export const POST = route(
  async ({ req, actor }) =>
    NextResponse.json({ email_account: await createMailbox(actor, await readJson(req)) }, { status: 201 }),
  { permission: "mailbox:create" },
);
