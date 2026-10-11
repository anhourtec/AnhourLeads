"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CrawlerStats } from "@/server/discovery/admin";
import type { OptoutView } from "@/server/discovery/optouts";
import type { listRemovalRequests } from "@/server/discovery/removal";
import type { SeedSourceView } from "@/server/discovery/seeds";
import type { DiscoverySettings } from "@/server/discovery/settings";

import { HostsTab } from "./hosts-tab";
import { OptoutsTab } from "./optouts-tab";
import { OverviewTab } from "./overview-tab";
import { QueueTab } from "./queue-tab";
import { SettingsTab } from "./settings-tab";
import { SourcesTab } from "./sources-tab";
import { isTab, TABS, type TabValue } from "./tabs";

export type RemovalRequestRow = Awaited<ReturnType<typeof listRemovalRequests>>[number];

export function PipelineView({
  initialTab,
  stats,
  sources,
  settings,
  optouts,
  optoutTotal,
  requests,
}: {
  initialTab: TabValue;
  stats: CrawlerStats;
  sources: SeedSourceView[];
  settings: DiscoverySettings;
  optouts: OptoutView[];
  optoutTotal: number;
  requests: RemovalRequestRow[];
}) {
  const [tab, setTab] = useState<TabValue>(initialTab);

  function change(value: string) {
    if (!isTab(value)) return;
    setTab(value);
    const url = new URL(window.location.href);
    if (value === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <Tabs value={tab} onValueChange={change} className="gap-4">
      <div className="-mx-1 max-w-full overflow-x-auto px-1">
        <TabsList aria-label="Data pipeline sections">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="overview">
        <OverviewTab initial={stats} onOpenTab={change} />
      </TabsContent>
      <TabsContent value="sources">
        <SourcesTab initial={sources} />
      </TabsContent>
      <TabsContent value="queue">{tab === "queue" && <QueueTab />}</TabsContent>
      <TabsContent value="hosts">{tab === "hosts" && <HostsTab />}</TabsContent>
      <TabsContent value="optouts">
        <OptoutsTab initial={optouts} initialTotal={optoutTotal} requests={requests} />
      </TabsContent>
      <TabsContent value="settings">
        <SettingsTab initial={settings} />
      </TabsContent>
    </Tabs>
  );
}
