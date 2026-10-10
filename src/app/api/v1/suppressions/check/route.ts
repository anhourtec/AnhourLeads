import { route } from "@/server/http/route";
import { checkSuppression } from "@/server/services/suppressions";

/** Is this address blocked, by its exact email or its domain? */
export const GET = route(
  async ({ req, actor }) => checkSuppression(actor, req.nextUrl.searchParams.get("email") ?? ""),
  { permission: "suppression:read" },
);
