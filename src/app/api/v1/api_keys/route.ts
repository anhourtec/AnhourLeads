import { NextResponse } from "next/server";

import { LIMITS } from "@/server/http/rate-limit";
import { pageFrom, pagination, readJson, route } from "@/server/http/route";
import { apiKeyCreateSchema, createApiKey, listApiKeys } from "@/server/services/api-keys";

/** API keys: name, prefix, role, creator, last use. Never the secret or its hash. */
export const GET = route(
  async ({ req, actor }) => {
    const page = pageFrom(Object.fromEntries(req.nextUrl.searchParams));
    const { apiKeys, total } = await listApiKeys(actor, page);
    return { api_keys: apiKeys, pagination: pagination(page, total) };
  },
  { permission: "apikey:read" },
);

/** Create a key. The response carries the secret; it is never shown again. */
export const POST = route(
  async ({ req, actor }) => {
    const { apiKey, secret } = await createApiKey(actor, apiKeyCreateSchema.parse(await readJson(req)));
    return NextResponse.json({ api_key: apiKey, secret }, { status: 201, headers: { "cache-control": "no-store" } });
  },
  { permission: "apikey:create", limit: LIMITS.sensitive },
);
