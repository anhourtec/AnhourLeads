import { readJson, route } from "@/server/http/route";
import { listRecordStages, recordStagesUpdateSchema, updateRecordStages } from "@/server/services/record-stages";

/** `?entityType=contact|company` (default contact). */
export const GET = route(
  async ({ req, actor }) => {
    const entityType = req.nextUrl.searchParams.get("entityType") === "company" ? "company" : "contact";
    return { entityType, stages: await listRecordStages(actor.organizationId, entityType) };
  },
  { permission: "contact:read" },
);

export const PUT = route(
  async ({ req, actor }) => {
    const input = recordStagesUpdateSchema.parse(await readJson(req));
    return { entityType: input.entityType, stages: await updateRecordStages(actor, input) };
  },
  { permission: "stage:manage" },
);
