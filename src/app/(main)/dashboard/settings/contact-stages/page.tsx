import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { log } from "@/server/log";
import { pageActor } from "@/server/services/engage-context";
import { listRecordStages } from "@/server/services/record-stages";
import { listStageTriggers } from "@/server/services/stage-triggers";

import { ErrorState } from "../../_components/pipeline/error-state";
import { StagesSettings } from "./_components/stages-settings";

export const metadata: Metadata = { title: "Contact fields and stages" };

export default async function ContactStagesPage({ searchParams }: PageProps<"/dashboard/settings/contact-stages">) {
  const { actor } = await pageActor("contact:read");
  const tab = (await searchParams).tab;
  const loaded = await Promise.all([
    listRecordStages(actor.organizationId, "contact"),
    listRecordStages(actor.organizationId, "company"),
    listStageTriggers(actor),
  ]).catch((error: unknown) => {
    log.error("stages failed to load", { component: "record-stages", error });
    return null;
  });
  if (!loaded) return <ErrorState />;
  const [contactStages, accountStages, triggers] = loaded;
  return (
    <StagesSettings
      initialTab={tab === "triggers" || tab === "accounts" ? tab : "stages"}
      contactStages={contactStages}
      accountStages={accountStages}
      triggers={triggers}
      canManage={can(actor.role, "stage:manage")}
    />
  );
}
