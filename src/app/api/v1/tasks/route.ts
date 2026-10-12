import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createTask, taskCreateSchema } from "@/server/services/tasks";

export const POST = route(
  async ({ req, actor }) => {
    const task = await createTask(actor, taskCreateSchema.parse(await readJson(req)));
    return NextResponse.json({ task }, { status: 201 });
  },
  { permission: "task:create" },
);
