import { readJson, route } from "@/server/http/route";
import { companyUpdateSchema, deleteCompany, getCompany, updateCompany } from "@/server/services/companies";

type Params = { id: string };

export const GET = route<Params>(async ({ actor, params }) => ({ account: await getCompany(actor, params.id) }), {
  permission: "company:read",
});

export const PATCH = route<Params>(
  async ({ req, actor, params }) => {
    const patch = companyUpdateSchema.parse(await readJson(req));
    return { account: await updateCompany(actor, params.id, patch) };
  },
  { permission: "company:update" },
);

export const DELETE = route<Params>(async ({ actor, params }) => deleteCompany(actor, params.id), {
  permission: "company:delete",
});
