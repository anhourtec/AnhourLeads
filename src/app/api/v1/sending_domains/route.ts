import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { addSendingDomain, addSendingDomainInput, listSendingDomains } from "@/server/services/sending-domains";

/** Sending domains: the mailboxes' domains plus any added by hand, with their DNS health. */
export const GET = route(async ({ actor }) => ({ sending_domains: await listSendingDomains(actor) }), {
  permission: "deliverability:read",
});

/** Add a domain and check its DNS right away. */
export const POST = route(
  async ({ req, actor }) => {
    const input = addSendingDomainInput.parse(await readJson(req));
    const { domain, created } = await addSendingDomain(actor, input);
    return NextResponse.json({ sending_domain: domain }, { status: created ? 201 : 200 });
  },
  { permission: "deliverability:manage" },
);
