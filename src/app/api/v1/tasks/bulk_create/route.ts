import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { bulkCreateTasks, taskBulkCreateSchema } from "@/server/services/tasks";

/** One task per contact in `contactIds`. */
export const POST = route(
  async ({ req, actor }) => {
    const tasks = await bulkCreateTasks(actor, taskBulkCreateSchema.parse(await readJson(req)));
    return NextResponse.json({ success: true, tasks }, { status: 201 });
  },
  { permission: "task:create" },
);
