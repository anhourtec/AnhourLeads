import { route } from "@/server/http/route";
import { sampleCsv } from "@/server/services/imports";
import { csvResponse } from "@/server/services/records";

/** A sample CSV with the recommended columns. */
export const GET = route(async () => csvResponse("accounts-import-template.csv", sampleCsv("company")), {
  permission: "company:import",
});
