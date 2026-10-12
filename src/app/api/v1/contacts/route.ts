import { NextResponse } from "next/server";

import { readJson, route } from "@/server/http/route";
import { contactCreateSchema, createContact } from "@/server/services/contacts";

/** Create a contact. `runDedupe: true` updates the existing contact with the same email instead of 409. */
export const POST = route(
  async ({ req, actor }) => {
    const input = contactCreateSchema.parse(await readJson(req));
    const result = await createContact(actor, input);
    return NextResponse.json({ contact: result.contact }, { status: result.created ? 201 : 200 });
  },
  { permission: "contact:create" },
);
