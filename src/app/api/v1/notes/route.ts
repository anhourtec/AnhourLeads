import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { createNote, listNotes, noteCreateSchema, noteListSchema } from "@/server/services/notes";

/** Notes on one record: `?entityType=contact|company|deal&entityId=…`, newest first. */
export const GET = route(
  async ({ req, actor }) => ({
    notes: await listNotes(actor, noteListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))),
  }),
  { permission: "contact:read" },
);

/** Add a note to a contact, company or deal. It also appears on the record's activity timeline. */
export const POST = route(
  async ({ req, actor }) =>
    NextResponse.json({ note: await createNote(actor, noteCreateSchema.parse(await readJson(req))) }, { status: 201 }),
  { permission: "note:create" },
);
