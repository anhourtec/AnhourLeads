import { route } from "@/server/http/route";
import { sequenceAnalytics } from "@/server/services/sequence-insights";

/** Per sequence and per step: sent, delivered, bounced, replied, interested, unsubscribed, opened. */
export const GET = route(async ({ actor }) => ({ analytics: await sequenceAnalytics(actor) }), {
  permission: "sequence:read",
});
