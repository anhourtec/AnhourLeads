import { type NextRequest, NextResponse } from "next/server";

import { guardPublicPost } from "@/server/discovery/public-http";
import { createRemovalRequest, removalRequestInput } from "@/server/discovery/removal";
import { errorResponse, readJson } from "@/server/http/route";

import { randomUUID } from "node:crypto";

/**
 * Public: ask for an email address or a domain to be removed from the discovery index. Nothing is
 * removed until the request is confirmed (emailed link, or DNS TXT record for a domain).
 */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  try {
    const { origin } = await guardPublicPost(req, "submit", 20);
    const input = removalRequestInput.parse(await readJson(req));
    const request = await createRemovalRequest(input, origin);
    return NextResponse.json({ request }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
