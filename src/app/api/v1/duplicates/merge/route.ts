import { readJson, route } from "@/server/http/route";
import { mergeDuplicates, mergeInput } from "@/server/services/data-health";

/**
 * Merge duplicates (`entityType`, `ids`, optional `keepId`). The record with more filled fields is
 * kept; list memberships, enrollments, tasks, deals, notes, activity and provenance move to it and
 * the others are deleted. Companies also need company:delete (checked in the service).
 */
export const POST = route(async ({ req, actor }) => mergeDuplicates(actor, mergeInput.parse(await readJson(req))), {
  permission: "contact:delete",
});
