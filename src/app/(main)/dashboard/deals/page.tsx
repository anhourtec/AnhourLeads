import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { searchDeals } from "@/server/services/deals";
import { searchMembers } from "@/server/services/members";

import { ErrorState } from "../_components/pipeline/error-state";
import { DealsView } from "./_components/deals-view";

export const metadata: Metadata = { title: "Deals" };

/** The board shows up to this many deals; totals always cover every deal. */
const LIMIT = 100;

export default async function DealsPage({ searchParams }: PageProps<"/dashboard/deals">) {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "deal:read")) notFound();

  const sp = await searchParams;
  const view = sp.view === "table" ? "table" : "board";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";
  const mine = sp.owner === "me";

  const loaded = await Promise.all([
    searchDeals(actor, { q: q ? q : undefined, mine }, { page: 1, perPage: LIMIT, offset: 0 }),
    searchMembers(actor, {}, { page: 1, perPage: 100, offset: 0 }),
  ]).catch((error: unknown) => {
    log.error("deals failed to load", { component: "deals", error });
    return null;
  });
  if (!loaded) return <ErrorState />;
  const [result, members] = loaded;

  return (
    <DealsView
      deals={result.deals}
      totals={result.totals}
      total={result.total}
      limit={LIMIT}
      members={members.users.map((m) => ({ id: m.id, name: m.name, email: m.email }))}
      currentUserId={context.user.id}
      role={actor.role}
      view={view}
    />
  );
}
