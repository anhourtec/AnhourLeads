import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { companyCreateSchema, createCompany } from "@/server/services/companies";

/** Create an account. `runDedupe: true` updates the existing account with the same domain instead of 409. */
export const POST = route(
  async ({ req, actor }) => {
    const input = companyCreateSchema.parse(await readJson(req));
    const result = await createCompany(actor, input);
    return NextResponse.json({ account: result.account }, { status: result.created ? 201 : 200 });
  },
  { permission: "company:create" },
);
