import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createSchedule, listSchedules } from "@/server/services/schedules";

/** Sending schedules (weekly windows in a time zone). A default "Normal business hours" exists in every workspace. */
export const GET = route(async ({ actor }) => ({ emailer_schedules: await listSchedules(actor) }), {
  permission: "sequence:read",
});

export const POST = route(
  async ({ req, actor }) =>
    NextResponse.json({ emailer_schedule: await createSchedule(actor, await readJson(req)) }, { status: 201 }),
  { permission: "schedule:manage" },
);
