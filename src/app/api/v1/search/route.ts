import { route } from "@/server/http/route";
import { globalSearch, globalSearchSchema } from "@/server/services/global-search";

/** Command palette search: people, companies and settings pages in the caller's workspace. */
export const GET = route(
  async ({ req, actor }) => {
    const { q } = globalSearchSchema.parse({ q: req.nextUrl.searchParams.get("q") ?? "" });
    return globalSearch(actor, q);
  },
  { permission: "search:run" },
);
