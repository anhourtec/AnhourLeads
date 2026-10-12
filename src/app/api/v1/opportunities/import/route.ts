import { NextResponse } from "next/server";

import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { importDeals } from "@/server/services/deals";
import { readImport } from "@/server/services/records";

/** Import deals from CSV (multipart `file`, JSON `{ csv }` or text/csv). `?pipelineId=` picks the pipeline. */
export const POST = route(
  async ({ req, actor }) => {
    const pipelineId = req.nextUrl.searchParams.get("pipelineId") ?? undefined;
    const report = await importDeals(actor, await readImport(req), { pipelineId });
    return NextResponse.json({ import: report }, { status: 201 });
  },
  { permission: "deal:create", limit: LIMITS.sensitive },
);
