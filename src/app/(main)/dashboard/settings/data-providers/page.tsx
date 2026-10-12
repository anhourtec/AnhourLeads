import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { listDataProviders } from "@/server/services/data-providers";

import { ErrorState } from "../../_components/pipeline/error-state";
import { DataProvidersManager } from "./_components/data-providers-manager";

export const metadata: Metadata = { title: "Data providers" };

export default async function DataProvidersPage() {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "provider:manage")) notFound();

  const providers = await listDataProviders(actor).catch((error: unknown) => {
    log.error("data providers failed to load", { component: "data-providers", error });
    return null;
  });
  if (!providers) return <ErrorState />;
  return <DataProvidersManager providers={providers} now={new Date().toISOString()} />;
}
