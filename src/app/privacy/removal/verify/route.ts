import { type NextRequest, NextResponse } from "next/server";

import { guardPublicPost } from "@/server/discovery/public-http";
import { removalVerifyInput, verifyRemovalRequest } from "@/server/discovery/removal";
import { errorResponse, readJson } from "@/server/http/route";

import { randomUUID } from "node:crypto";

/** Public: confirm a removal request with the emailed link's secret, or by checking the domain's DNS TXT record. */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  try {
    await guardPublicPost(req, "verify", 30);
    const input = removalVerifyInput.parse(await readJson(req));
    const result = await verifyRemovalRequest(input);
    return NextResponse.json(
      { confirmed: true, kind: result.optout.kind, value: result.optout.value, removed: result.removed },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error, requestId);
  }
}
