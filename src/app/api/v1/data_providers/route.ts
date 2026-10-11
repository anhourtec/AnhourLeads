import { NextResponse } from "next/server";

import { LIMITS } from "@/server/http/rate-limit";
import { readJson, route } from "@/server/http/route";
import { dataProviderCreateSchema, listDataProviders, saveDataProvider } from "@/server/services/data-providers";

/** The workspace's own data-provider keys: provider, last four characters, status. Never the key. */
export const GET = route(
  async ({ actor }) => {
    const dataProviders = await listDataProviders(actor);
    return { data_providers: dataProviders };
  },
  { permission: "provider:manage" },
);

/** Connect a provider, or replace its key. The key is stored encrypted and never returned. */
export const POST = route(
  async ({ req, actor }) => {
    const { dataProvider, created } = await saveDataProvider(
      actor,
      dataProviderCreateSchema.parse(await readJson(req)),
    );
    return NextResponse.json(
      { data_provider: dataProvider },
      { status: created ? 201 : 200, headers: { "cache-control": "no-store" } },
    );
  },
  { permission: "provider:manage", limit: LIMITS.sensitive },
);
