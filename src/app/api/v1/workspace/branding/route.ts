import { readJson, route } from "@/server/http/route";
import { brandingInput, getBranding, updateBranding } from "@/server/services/branding";

/** The workspace's white-label brand. Any member (or API key) may read it. */
export const GET = route(async ({ actor }) => ({ branding: await getBranding(actor.organizationId) }));

/** Change the brand name, colour or support email. null resets a field to the default. */
export const PATCH = route(
  async ({ req, actor }) => {
    const input = brandingInput.parse(await readJson(req));
    return { branding: await updateBranding(actor, input) };
  },
  { permission: "branding:update" },
);
