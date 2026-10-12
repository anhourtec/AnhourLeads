import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { log } from "@/server/log";
import { pageActor } from "@/server/services/engage-context";
import { listSnippets, listTemplates } from "@/server/services/templates";

import { ErrorState } from "../../_components/pipeline/error-state";
import { PageHeader } from "../../_components/pipeline/page-header";
import { TemplatesTabs } from "./_components/templates-tabs";

export const metadata: Metadata = { title: "Snippets & templates" };

export default async function TemplatesPage({ searchParams }: PageProps<"/dashboard/settings/templates">) {
  const { actor } = await pageActor("template:read");
  const tab = (await searchParams).tab === "snippets" ? "snippets" : "templates";
  const loaded = await Promise.all([listTemplates(actor), listSnippets(actor)]).catch((error: unknown) => {
    log.error("templates failed to load", { component: "templates", error });
    return null;
  });
  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <PageHeader
        title="Snippets & templates"
        description="Reusable emails for sequences and one-off sends, and short snippets for emails and task descriptions."
      />
      {loaded ? (
        <TemplatesTabs
          initialTab={tab}
          templates={loaded[0]}
          snippets={loaded[1]}
          access={{
            canCreate: can(actor.role, "template:create"),
            canUpdate: can(actor.role, "template:update"),
            canDeleteAny: can(actor.role, "template:delete"),
            currentUserId: actor.userId,
          }}
        />
      ) : (
        <ErrorState />
      )}
    </div>
  );
}
