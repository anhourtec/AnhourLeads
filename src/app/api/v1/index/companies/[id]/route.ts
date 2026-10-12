import { route } from "@/server/http/route";
import { getIndexCompany } from "@/server/services/discovery";

/** One index company with its people, job postings, news and provenance. */
export const GET = route<{ id: string }>(async ({ actor, params }) => getIndexCompany(actor, params.id), {
  permission: "search:run",
});
