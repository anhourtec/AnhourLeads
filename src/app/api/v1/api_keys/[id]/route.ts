import { route } from "@/server/http/route";
import { revokeApiKey } from "@/server/services/api-keys";

/** Revoke a key. It stops working immediately and stays listed as revoked. */
export const DELETE = route<{ id: string }>(
  async ({ actor, params }) => ({ api_key: await revokeApiKey(actor, params.id) }),
  { permission: "apikey:revoke" },
);
