import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { searchSequences } from "@/server/services/sequences";

/** Search sequences by name (`q` or `qName`) and status, with per-sequence stats. */
export const POST = route(
  async ({ req, actor }) => {
    const body = (await readJson(req)) as Record<string, unknown>;
    const page = pageFrom({ ...Object.fromEntries(req.nextUrl.searchParams), ...body });
    const { sequences, total } = await searchSequences(actor, body, page);
    return { emailer_campaigns: sequences, pagination: pagination(page, total) };
  },
  { permission: "sequence:read" },
);
