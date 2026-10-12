import { LIMITS } from "@/server/http/rate-limit";
import { route } from "@/server/http/route";
import { checkSendingDomain } from "@/server/services/sending-domains";

/** Re-run the SPF, DKIM, DMARC and MX checks for one domain. */
export const POST = route<{ id: string }>(
  async ({ actor, params }) => ({ sending_domain: await checkSendingDomain(actor, params.id) }),
  { permission: "deliverability:manage", limit: LIMITS.sensitive },
);
