import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";

/** Gate outside the loading boundary: importing needs contact:import or company:import. */
export default async function ImportLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { workspace } = await getAppContext();
  if (!workspace || !(can(workspace.role, "contact:import") || can(workspace.role, "company:import"))) {
    redirect("/unauthorized");
  }
  return children;
}
