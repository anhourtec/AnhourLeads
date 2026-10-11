import type { ReactNode } from "react";

import { notFound } from "next/navigation";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { actorFromContext } from "@/server/auth/context-actor";
import { HttpError } from "@/server/http/errors";
import { getDashboard } from "@/server/services/dashboards";

/** Existence gate outside the loading boundary: other workspaces' (or private) dashboards are a real 404. */
export default async function DashboardLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ id: string }> }>) {
  const actor = actorFromContext(await getAppContext());
  if (!actor || !can(actor.role, "analytics:read")) notFound();
  const { id } = await params;
  try {
    await getDashboard(actor, id);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound();
    throw error;
  }
  return children;
}
