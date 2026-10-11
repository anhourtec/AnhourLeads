import { getDiscoverySettings, settingsInput, updateDiscoverySettings } from "@/server/discovery/settings";
import { readJson, route } from "@/server/http/route";
import { audit } from "@/server/services/audit";
import { requirePlatformAdmin } from "@/server/services/platform";

/** Retention for people not seen and re-crawl intervals per page kind. Platform administrators only. */
export const GET = route(async ({ actor }) => {
  requirePlatformAdmin(actor);
  return { settings: await getDiscoverySettings() };
});

export const PATCH = route(async ({ req, actor }) => {
  requirePlatformAdmin(actor);
  const settings = await updateDiscoverySettings(settingsInput.parse(await readJson(req)));
  await audit(actor, "discovery.settings.update", "discovery_settings", null);
  return { settings };
});
