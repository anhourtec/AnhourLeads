import { orNotFound, pageActor } from "@/server/services/engage-context";
import { findSequence } from "@/server/services/sequences";

/** Check the sequence exists outside the loading boundary, so a missing or out-of-scope id gets a real 404 status. */
export default async function SequenceLayout({ children, params }: LayoutProps<"/dashboard/sequences/[id]">) {
  const { actor } = await pageActor("sequence:read");
  await orNotFound(findSequence(actor, (await params).id));
  return children;
}
