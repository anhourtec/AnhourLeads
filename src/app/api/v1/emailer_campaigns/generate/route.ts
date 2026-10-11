import { z } from "zod";

import { SEQUENCE_TEMPLATES } from "@/lib/engage-constants";
import { readJson, route } from "@/server/http/route";
import { generateSequence, generateSequenceSchema, sequenceTemplate } from "@/server/services/sequence-drafts";

const templateInput = z
  .object({ template: z.enum(SEQUENCE_TEMPLATES.map((t) => t.id) as [string, ...string[]]) })
  .strict();

/**
 * Draft a whole sequence: either from a ready-made template (`{ template }`) or from an audience,
 * goal, number of steps and tone. Returns `{ name, steps }` to pass to POST /emailer_campaigns.
 */
export const POST = route(
  async ({ req, actor: _actor }) => {
    const body = await readJson(req);
    const asTemplate = templateInput.safeParse(body);
    if (asTemplate.success) {
      return { draft: sequenceTemplate(asTemplate.data.template as (typeof SEQUENCE_TEMPLATES)[number]["id"]) };
    }
    return { draft: generateSequence(generateSequenceSchema.parse(body)) };
  },
  { permission: "sequence:create" },
);
