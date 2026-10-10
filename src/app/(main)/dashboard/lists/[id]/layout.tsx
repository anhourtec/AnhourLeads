import { orNotFound, pageActor } from "@/server/services/engage-context";
import { findList } from "@/server/services/lists";

/** Check the list exists outside the loading boundary, so a missing or out-of-scope id gets a real 404 status. */
export default async function ListLayout({ children, params }: LayoutProps<"/dashboard/lists/[id]">) {
  const { actor } = await pageActor("list:read");
  await orNotFound(findList(actor, (await params).id));
  return children;
}
