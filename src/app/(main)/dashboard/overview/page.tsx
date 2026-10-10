import type { Metadata } from "next";

import { getAppContext } from "@/server/auth/context";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const { user, workspace } = await getAppContext();
  return (
    <div className="flex flex-col gap-1">
      <h1 className="font-medium text-2xl">Welcome, {user.name}</h1>
      <p className="text-muted-foreground text-sm">{workspace ? workspace.name : "You aren't in a workspace yet."}</p>
    </div>
  );
}
