import type { ReactNode } from "react";

import { notFound } from "next/navigation";

import { getAppContext } from "@/server/auth/context";

/** Every workspace member can see their own usage; the page shows more with `audit:read`. */
export default async function UsageLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { workspace } = await getAppContext();
  if (!workspace) notFound();
  return children;
}
