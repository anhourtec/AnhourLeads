import { readJson, route } from "@/server/http/route";
import { dataProviderUpdateSchema, deleteDataProvider, setDataProviderEnabled } from "@/server/services/data-providers";

/** Turn a provider on or off for enrichment without removing its key. */
export const PATCH = route<{ id: string }>(
  async ({ req, actor, params }) => {
    const { enabled } = dataProviderUpdateSchema.parse(await readJson(req));
    return { data_provider: await setDataProviderEnabled(actor, params.id, enabled) };
  },
  { permission: "provider:manage" },
);

/** Remove a provider and its stored key. */
export const DELETE = route<{ id: string }>(async ({ actor, params }) => deleteDataProvider(actor, params.id), {
  permission: "provider:manage",
});
