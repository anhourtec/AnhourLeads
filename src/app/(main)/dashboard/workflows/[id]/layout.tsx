import type { ReactNode } from "react";

import { notFound } from "next/navigation";

import { and, eq } from "drizzle-orm";

import { getAppContext } from "@/server/auth/context";
import { db, schema } from "@/server/db";

/** Unknown or other workspaces' workflow ids get a real 404 status (checked outside the loading boundary). */
export default async function WorkflowLayout({
  children,
  params,
}: Readonly<{ children: ReactNode; params: Promise<{ id: string }> }>) {
  const { workspace } = await getAppContext();
  const { id } = await params;
  if (!workspace) notFound();
  const [row] = await db
    .select({ id: schema.workflow.id })
    .from(schema.workflow)
    .where(and(eq(schema.workflow.organizationId, workspace.organizationId), eq(schema.workflow.id, id)))
    .limit(1);
  if (!row) notFound();
  return children;
}
