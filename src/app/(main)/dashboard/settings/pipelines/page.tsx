import type { Metadata } from "next";

import { log } from "@/server/log";
import { pageActor } from "@/server/services/engage-context";
import { listPipelines } from "@/server/services/pipelines";

import { ErrorState } from "../../_components/pipeline/error-state";
import { PipelinesManager } from "./_components/pipelines-manager";

export const metadata: Metadata = { title: "Deal pipelines" };

export default async function PipelinesSettingsPage() {
  const { actor } = await pageActor("pipeline:manage");
  const pipelines = await listPipelines(actor).catch((error: unknown) => {
    log.error("pipelines failed to load", { component: "pipelines", error });
    return null;
  });
  if (!pipelines) return <ErrorState />;
  return <PipelinesManager pipelines={pipelines} />;
}
