import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { getAppContext } from "@/server/auth/context";
import { crawlerStats } from "@/server/discovery/admin";
import { listOptouts } from "@/server/discovery/optouts";
import { listRemovalRequests } from "@/server/discovery/removal";
import { listSeedSources } from "@/server/discovery/seeds";
import { getDiscoverySettings } from "@/server/discovery/settings";

import { PipelineView } from "./_components/data-view";
import { isTab } from "./_components/tabs";

export const metadata: Metadata = { title: "Data pipeline" };

export default async function PlatformDataPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { user } = await getAppContext();
  if (!user.isPlatformAdmin) notFound();
  const { tab } = await searchParams;
  const [stats, sources, settings, optouts, requests] = await Promise.all([
    crawlerStats(),
    listSeedSources(),
    getDiscoverySettings(),
    listOptouts({}, { perPage: 50, offset: 0 }),
    listRemovalRequests(),
  ]);

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="space-y-1">
        <h1 className="page-title">Data pipeline</h1>
        <p className="max-w-prose text-muted-foreground text-sm">
          The installation-wide discovery index and the crawler fleet that builds it from public sources only: company
          websites, their feeds and public job boards, and Wikidata.
        </p>
      </div>
      <PipelineView
        initialTab={tab && isTab(tab) ? tab : "overview"}
        stats={stats}
        sources={sources}
        settings={settings}
        optouts={optouts.optouts}
        optoutTotal={optouts.total}
        requests={requests}
      />
    </div>
  );
}
