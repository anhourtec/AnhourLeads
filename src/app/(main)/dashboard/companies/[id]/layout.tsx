import { getCompany } from "@/server/services/companies";
import { orNotFound } from "@/server/services/engage-context";
import { recordsPageActor } from "@/server/services/records";

/** Resolve the company outside the loading boundary, so a missing or out-of-scope id gets a real 404 status. */
export default async function CompanyLayout({ children, params }: LayoutProps<"/dashboard/companies/[id]">) {
  const { actor } = await recordsPageActor("company:read");
  await orNotFound(getCompany(actor, (await params).id));
  return children;
}
