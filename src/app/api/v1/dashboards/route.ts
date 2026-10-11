import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createDashboard, createDashboardInput, listDashboards } from "@/server/services/dashboards";

/** Dashboards visible to the caller: the system ones, shared ones and their own. */
export const GET = route(async ({ actor }) => ({ dashboards: await listDashboards(actor) }), {
  permission: "analytics:read",
});

export const POST = route(
  async ({ req, actor }) => {
    const input = createDashboardInput.parse(await readJson(req));
    return NextResponse.json({ dashboard: await createDashboard(actor, input) }, { status: 201 });
  },
  { permission: "dashboard:manage" },
);
