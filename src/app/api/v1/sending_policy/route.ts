import { readJson, route } from "@/server/http/route";
import {
  getSendingPolicy,
  protectionCounters,
  sendingPolicyPatch,
  updateSendingPolicy,
} from "@/server/services/sending-policy";

/** Sending protection policy and its counters for the last 30 days. */
export const GET = route(
  async ({ actor }) => {
    const [policy, counters] = await Promise.all([getSendingPolicy(actor), protectionCounters(actor)]);
    return { sending_policy: policy, counters };
  },
  { permission: "deliverability:read" },
);

/** Change one or more policy switches. Audited; one-click unsubscribe can't be turned off. */
export const PATCH = route(
  async ({ req, actor }) => {
    const patch = sendingPolicyPatch.parse(await readJson(req));
    return { sending_policy: await updateSendingPolicy(actor, patch) };
  },
  { permission: "deliverability:manage" },
);
