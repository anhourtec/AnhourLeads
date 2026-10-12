import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { log } from "@/server/log";
import { pageActor } from "@/server/services/engage-context";
import { listPersonas } from "@/server/services/personas";

import { ErrorState } from "../../_components/pipeline/error-state";
import { PersonasManager } from "./_components/personas-manager";

export const metadata: Metadata = { title: "Personas" };

export default async function PersonasPage() {
  const { actor } = await pageActor("contact:read");
  const personas = await listPersonas(actor).catch((error: unknown) => {
    log.error("personas failed to load", { component: "personas", error });
    return null;
  });
  if (!personas) return <ErrorState />;
  return <PersonasManager personas={personas} canManage={can(actor.role, "persona:manage")} />;
}
