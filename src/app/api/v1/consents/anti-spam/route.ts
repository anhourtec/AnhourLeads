import { readJson, route } from "@/server/http/route";
import { acceptAntiSpam, antiSpamState } from "@/server/services/consents";

/** Whether you still need to accept the anti-spam acknowledgement before creating a sequence. */
export const GET = route(async ({ actor }) => ({ anti_spam: await antiSpamState(actor) }));

/** Accept it ("I will comply"): `{ "accepted": true }`. Any member, for themselves only. */
export const POST = route(async ({ req, actor }) => ({ anti_spam: await acceptAntiSpam(actor, await readJson(req)) }));
