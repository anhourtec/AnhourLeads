import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { deliverabilityOverview, mailboxSummary } from "@/server/services/deliverability";
import { listSendingDomains } from "@/server/services/sending-domains";
import { getSendingPolicy, protectionCounters } from "@/server/services/sending-policy";

import { ErrorState } from "../../_components/pipeline/error-state";
import { PageHeader } from "../../_components/pipeline/page-header";
import { DeliverabilityView } from "./_components/deliverability-view";
import { isTab } from "./_components/tabs";

export const metadata: Metadata = { title: "Email setup and health" };

export default async function DeliverabilityPage({ searchParams }: PageProps<"/dashboard/settings/deliverability">) {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "deliverability:read")) notFound();
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" && isTab(sp.tab) ? sp.tab : "overview";

  const loaded = await Promise.all([
    deliverabilityOverview(actor, { days: 7 }),
    mailboxSummary(actor),
    listSendingDomains(actor),
    getSendingPolicy(actor),
    protectionCounters(actor),
  ]).catch((error: unknown) => {
    log.error("deliverability failed to load", { component: "deliverability", error });
    return null;
  });

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Email setup and health"
        description="Authenticate your sending domains, watch how your mailboxes perform and decide which protections apply before anything is sent."
      />
      {loaded ? (
        <DeliverabilityView
          initialTab={tab}
          overview={loaded[0]}
          mailboxes={loaded[1]}
          domains={loaded[2]}
          policy={loaded[3]}
          counters={loaded[4]}
          canManage={can(actor.role, "deliverability:manage")}
          canInvite={can(actor.role, "member:invite")}
        />
      ) : (
        <ErrorState />
      )}
    </div>
  );
}
