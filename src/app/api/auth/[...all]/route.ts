import { NextResponse } from "next/server";

import { getAuth } from "@/server/auth/auth";
import { requestHost, resolveTenant } from "@/server/tenancy/host";

/** Better Auth endpoints, served by the instance for the request's hostname. Unknown hosts get 404. */
async function handle(req: Request): Promise<Response> {
  const tenant = await resolveTenant(requestHost(req.headers));
  if (!tenant) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return getAuth(tenant).handler(req);
}

export const GET = handle;
export const POST = handle;
