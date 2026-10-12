import { readJson, route } from "@/server/http/route";
import { dealUpdateSchema, deleteDeal, getDeal, updateDeal } from "@/server/services/deals";

type Params = { id: string };

export const GET = route<Params>(async ({ actor, params }) => ({ opportunity: await getDeal(actor, params.id) }), {
  permission: "deal:read",
});

export const PATCH = route<Params>(
  async ({ req, actor, params }) => ({
    opportunity: await updateDeal(actor, params.id, dealUpdateSchema.parse(await readJson(req))),
  }),
  { permission: "deal:update" },
);

export const DELETE = route<Params>(
  async ({ actor, params }) => {
    await deleteDeal(actor, params.id);
    return { deleted: true, id: params.id };
  },
  { permission: "deal:delete" },
);
