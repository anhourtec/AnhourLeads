import { getContact } from "@/server/services/contacts";
import { orNotFound } from "@/server/services/engage-context";
import { recordsPageActor } from "@/server/services/records";

/** Resolve the person outside the loading boundary, so a missing or out-of-scope id gets a real 404 status. */
export default async function PersonLayout({ children, params }: LayoutProps<"/dashboard/people/[id]">) {
  const { actor } = await recordsPageActor("contact:read");
  await orNotFound(getContact(actor, (await params).id));
  return children;
}
