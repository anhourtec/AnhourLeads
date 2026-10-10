import { route } from "@/server/http/route";
import { apiProfile } from "@/server/services/members";

/** Who is calling: user or API key, workspace, role and the permissions it grants. */
export const GET = route(async ({ actor }) => apiProfile(actor));
