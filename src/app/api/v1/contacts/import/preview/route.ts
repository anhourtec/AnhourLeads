import { route } from "@/server/http/route";
import { importPreview } from "@/server/services/imports";
import { readImport } from "@/server/services/records";

/** Read a CSV's header and first rows: detected columns, the field each maps to, samples and the fields on offer. */
export const POST = route(async ({ req, actor }) => importPreview(actor, "contact", (await readImport(req)).csv), {
  permission: "contact:import",
});
