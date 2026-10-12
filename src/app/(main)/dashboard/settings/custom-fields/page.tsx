import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { log } from "@/server/log";
import { listCustomFields } from "@/server/services/custom-fields";
import { pageActor } from "@/server/services/engage-context";

import { ErrorState } from "../../_components/pipeline/error-state";
import { CustomFieldsManager } from "./_components/custom-fields-manager";

export const metadata: Metadata = { title: "Custom fields" };

export default async function CustomFieldsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await pageActor("contact:read");
  const tab = (await searchParams).tab;
  const fields = await listCustomFields(actor).catch((error: unknown) => {
    log.error("custom fields failed to load", { component: "custom-fields", error });
    return null;
  });
  if (!fields) return <ErrorState />;
  const initialTab = tab === "company" || tab === "deal" ? tab : "contact";
  return (
    <CustomFieldsManager fields={fields} canManage={can(actor.role, "customfield:manage")} initialTab={initialTab} />
  );
}
