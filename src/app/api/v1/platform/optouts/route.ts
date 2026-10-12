import { NextResponse } from "next/server";

import { z } from "zod";

import {
  addOptout,
  listOptouts,
  normalizeOptoutDomain,
  normalizeOptoutEmail,
  normalizeOptoutPerson,
} from "@/server/discovery/optouts";
import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { audit } from "@/server/services/audit";
import { requirePlatformAdmin } from "@/server/services/platform";
import { queryObject } from "@/server/services/records";

const listQuery = z.object({
  q: z.string().trim().max(300).optional(),
  kind: z.enum(["domain", "email", "person"]).optional(),
});

const createInput = z
  .strictObject({
    kind: z.enum(["domain", "email", "person"]),
    /** Domain, email address, or the person's full name (with `domain`). */
    value: z.string().trim().min(2).max(254),
    domain: z.string().trim().max(254).optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .transform((v, ctx) => {
    const value =
      v.kind === "domain"
        ? normalizeOptoutDomain(v.value)
        : v.kind === "email"
          ? normalizeOptoutEmail(v.value)
          : normalizeOptoutPerson(v.value, v.domain ?? "");
    if (!value) {
      const message =
        v.kind === "domain"
          ? "Enter a domain such as example.com."
          : v.kind === "email"
            ? "Enter a valid email address."
            : "Enter the person's full name and their company's domain.";
      ctx.addIssue({
        code: "custom",
        path: [v.kind === "person" && v.value.length >= 2 ? "domain" : "value"],
        message,
      });
      return z.NEVER;
    }
    return { kind: v.kind, value, reason: v.reason };
  });

/** Index opt-outs (domains, addresses, people). Adding one deletes what the index holds about it. Platform administrators only. */
export const GET = route(async ({ req, actor }) => {
  requirePlatformAdmin(actor);
  const query = queryObject(req.url);
  const page = pageFrom(query);
  const { optouts, total } = await listOptouts(listQuery.parse(query), page);
  return { optouts, pagination: pagination(page, total) };
});

export const POST = route(async ({ req, actor }) => {
  requirePlatformAdmin(actor);
  const input = createInput.parse(await readJson(req));
  const result = await addOptout({ ...input, requestedBy: `platform_admin:${actor.userId}` });
  await audit(actor, "discovery.optout.create", "index_optout", result.optout.id, { kind: input.kind });
  return NextResponse.json(result, { status: result.created ? 201 : 200 });
});
