import { readJson, route } from "@/server/http/route";
import { deleteSchedule, updateSchedule } from "@/server/services/schedules";

type P = { id: string };

export const PATCH = route<P>(
  async ({ req, actor, params }) => ({ emailer_schedule: await updateSchedule(actor, params.id, await readJson(req)) }),
  { permission: "schedule:manage" },
);

export const DELETE = route<P>(
  async ({ actor, params }) => {
    await deleteSchedule(actor, params.id);
    return { deleted: true };
  },
  { permission: "schedule:manage" },
);
