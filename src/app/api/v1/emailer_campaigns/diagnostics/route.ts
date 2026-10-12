import { route } from "@/server/http/route";
import { sequenceDiagnostics } from "@/server/services/sequence-insights";

/** Sequences with problems (mailbox, signature, bounces, bounce guard, disabled steps, merge fields). */
export const GET = route(async ({ actor }) => ({ diagnostics: await sequenceDiagnostics(actor) }), {
  permission: "sequence:read",
});
