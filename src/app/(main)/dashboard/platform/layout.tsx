import type { ReactNode } from "react";

import { notFound } from "next/navigation";

import { getAppContext } from "@/server/auth/context";

/** Platform administrators only. Gate outside the loading boundary, so everyone else gets a real 404 status. */
export default async function PlatformLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { user } = await getAppContext();
  if (!user.isPlatformAdmin) notFound();
  return children;
}
