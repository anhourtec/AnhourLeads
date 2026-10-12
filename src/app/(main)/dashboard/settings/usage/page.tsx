import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { getUsage, USAGE_COUNTERS, USAGE_LABELS } from "@/server/services/usage";

import { ErrorState } from "../../_components/pipeline/error-state";
import { PageHeader } from "../../_components/pipeline/page-header";
import { UsageView } from "./_components/usage-view";

export const metadata: Metadata = { title: "Usage and activity" };

export default async function UsagePage() {
  const actor = actorFromContext(await getAppContext());
  if (!actor) notFound();
  const usage = await getUsage(actor).catch((error: unknown) => {
    log.error("usage failed to load", { component: "usage", error });
    return null;
  });
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Usage and activity"
        description="What was used this month compared with last month. There are no credits: lookups run on your own installation, and cached results are reused for free."
      />
      {usage ? (
        <UsageView usage={usage} counters={USAGE_COUNTERS.map((key) => ({ key, label: USAGE_LABELS[key] }))} />
      ) : (
        <ErrorState />
      )}
    </div>
  );
}
