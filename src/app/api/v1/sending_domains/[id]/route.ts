import { route } from "@/server/http/route";
import { deleteSendingDomain } from "@/server/services/sending-domains";

export const DELETE = route<{ id: string }>(async ({ actor, params }) => deleteSendingDomain(actor, params.id), {
  permission: "deliverability:manage",
});
