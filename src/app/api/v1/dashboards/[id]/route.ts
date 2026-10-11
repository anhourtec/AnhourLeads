import { readJson, route } from "@/server/http/route";
import {
  dashboardWithData,
  deleteDashboard,
  updateDashboard,
  updateDashboardInput,
} from "@/server/services/dashboards";

/** One dashboard with each widget's data (`data[widgetId]`). */
export const GET = route<{ id: string }>(async ({ actor, params }) => dashboardWithData(actor, params.id), {
  permission: "analytics:read",
});

/** Rename, replace widgets, star or share. System dashboards can only be starred. */
export const PATCH = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const input = updateDashboardInput.parse(await readJson(req));
    return { dashboard: await updateDashboard(actor, params.id, input) };
  },
  { permission: "dashboard:manage" },
);

export const DELETE = route<{ id: string }>(async ({ actor, params }) => deleteDashboard(actor, params.id), {
  permission: "dashboard:manage",
});
