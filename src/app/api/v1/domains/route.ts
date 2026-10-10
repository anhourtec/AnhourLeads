import { NextResponse } from "next/server";

import { z } from "zod";

import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { addDomain, listDomains } from "@/server/services/domains";

/** The workspace's custom hostnames, with their DNS records and usage. */
export const GET = route(async ({ actor }) => listDomains(actor.organizationId), { permission: "domain:read" });

const body = z.object({ hostname: z.string({ error: "Enter a hostname like portal.example.com." }) });

/** Add a hostname: pending until its DNS TXT record proves ownership (local names are verified on add). */
export const POST = route(
  async ({ req, actor }) => {
    const { hostname } = body.parse(await readJson(req));
    const result = await addDomain(actor, hostname);
    return NextResponse.json(result, { status: 201 });
  },
  { permission: "domain:manage", limit: LIMITS.sensitive },
);
