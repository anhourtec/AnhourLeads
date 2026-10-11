import type { MessageView } from "@/server/services/emails";

import { type Tone, TonePill } from "../../_components/engage/tone-pill";

const STATUS: Record<MessageView["status"], [Tone, string]> = {
  pending_review: ["neutral", "Pending review"],
  queued: ["neutral", "Scheduled"],
  sent: ["positive", "Delivered"],
  failed: ["negative", "Failed"],
  bounced: ["negative", "Bounced"],
  blocked: ["attention", "Not sent"],
};

/** Status as the Emails screen names it; a sent email whose contact replied shows "Replied". */
export function MessageStatus({ message }: { message: Pick<MessageView, "status" | "replied"> }) {
  if (message.replied) return <TonePill tone="info">Replied</TonePill>;
  const [tone, label] = STATUS[message.status];
  return <TonePill tone={tone}>{label}</TonePill>;
}
