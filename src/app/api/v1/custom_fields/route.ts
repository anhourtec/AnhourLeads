import { NextResponse } from "next/server";

import { z } from "zod";

import { readJson, route } from "@/server/http/route";
import {
  CUSTOM_FIELD_ENTITIES,
  createCustomField,
  customFieldCreateSchema,
  listCustomFields,
} from "@/server/services/custom-fields";

const query = z.object({ entityType: z.enum(CUSTOM_FIELD_ENTITIES).optional() });

/** Custom fields of the workspace, optionally for one record type. */
export const GET = route(
  async ({ req, actor }) => {
    const { entityType } = query.parse(Object.fromEntries(req.nextUrl.searchParams));
    return { custom_fields: await listCustomFields(actor, entityType) };
  },
  { permission: "contact:read" },
);

/** Create a custom field (key generated from the label unless given). */
export const POST = route(
  async ({ req, actor }) => {
    const input = customFieldCreateSchema.parse(await readJson(req));
    return NextResponse.json({ custom_field: await createCustomField(actor, input) }, { status: 201 });
  },
  { permission: "customfield:manage" },
);
