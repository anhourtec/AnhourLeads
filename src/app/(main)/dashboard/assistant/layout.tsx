import type { ReactNode } from "react";

import { notFound } from "next/navigation";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";

/** Gate outside the loading boundary, so people without `ai:use` get a real 404 status. */
export default async function AssistantLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { workspace } = await getAppContext();
  if (!workspace || !can(workspace.role, "ai:use")) notFound();
  return children;
}
