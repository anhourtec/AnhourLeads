import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { getAiContext } from "@/server/services/ai";

import { ErrorState } from "../../_components/pipeline/error-state";
import { PageHeader } from "../../_components/pipeline/page-header";
import { AiContextForm } from "./_components/ai-context-form";

export const metadata: Metadata = { title: "AI context center" };

export default async function AiContextPage() {
  const actor = actorFromContext(await getAppContext());
  if (!actor || !can(actor.role, "ai:use")) notFound();
  const context = await getAiContext(actor).catch((error: unknown) => {
    log.error("ai context failed to load", { component: "ai", error });
    return null;
  });

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="AI context center"
        description="Describe what your company sells and to whom. The AI assistant and email drafts use only this and your workspace data, never guesses."
      />
      {context ? <AiContextForm initial={context} canEdit={can(actor.role, "aicontext:manage")} /> : <ErrorState />}
    </div>
  );
}
