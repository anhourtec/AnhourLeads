import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { log } from "@/server/log";
import { listApiKeys } from "@/server/services/api-keys";

import { ErrorState } from "../../_components/pipeline/error-state";
import { ApiKeysManager } from "./_components/api-keys-manager";

export const metadata: Metadata = { title: "API keys" };

export default async function ApiKeysPage() {
  const context = await getAppContext();
  const actor = actorFromContext(context);
  if (!actor || !can(actor.role, "apikey:read")) notFound();

  const result = await listApiKeys(actor, { page: 1, perPage: 100, offset: 0 }).catch((error: unknown) => {
    log.error("api keys failed to load", { component: "api-keys", error });
    return null;
  });
  if (!result) return <ErrorState />;
  return <ApiKeysManager keys={result.apiKeys} role={actor.role} now={new Date().toISOString()} />;
}
