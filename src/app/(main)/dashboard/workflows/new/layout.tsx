import type { ReactNode } from "react";

import { notFound } from "next/navigation";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";

/** Only members who can create workflows open the new-workflow screen (real 404 for everyone else). */
export default async function NewWorkflowLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { workspace } = await getAppContext();
  if (!workspace || !can(workspace.role, "workflow:create")) notFound();
  return children;
}
