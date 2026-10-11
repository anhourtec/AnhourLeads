"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SendingPolicyView } from "@/lib/sending-policy";
import type { DeliverabilityOverview, MailboxSummary } from "@/server/services/deliverability";
import type { SendingDomainView } from "@/server/services/sending-domains";
import type { ProtectionCounters } from "@/server/services/sending-policy";

import { DomainsTab } from "./domains-tab";
import { MailboxesTab } from "./mailboxes-tab";
import { OverviewTab } from "./overview-tab";
import { ProtectionTab } from "./protection-tab";
import { isTab, TABS, type TabValue } from "./tabs";

export function DeliverabilityView({
  initialTab,
  overview,
  mailboxes,
  domains,
  policy,
  counters,
  canManage,
  canInvite,
}: {
  initialTab: TabValue;
  overview: DeliverabilityOverview;
  mailboxes: MailboxSummary[];
  domains: SendingDomainView[];
  policy: SendingPolicyView;
  counters: ProtectionCounters;
  canManage: boolean;
  canInvite: boolean;
}) {
  const [tab, setTab] = useState<TabValue>(initialTab);

  function change(value: string) {
    if (!isTab(value)) return;
    setTab(value);
    // Shallow URL update: the tab is shareable without re-rendering the server page.
    const url = new URL(window.location.href);
    if (value === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    window.history.replaceState(window.history.state, "", url);
  }

  return (
    <Tabs value={tab} onValueChange={change} className="gap-4">
      <div className="-mx-1 max-w-full overflow-x-auto px-1">
        <TabsList aria-label="Email setup and health sections">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="overview">
        <OverviewTab initial={overview} canInvite={canInvite} onOpenTab={change} />
      </TabsContent>
      <TabsContent value="domains">
        <DomainsTab initial={domains} canManage={canManage} />
      </TabsContent>
      <TabsContent value="mailboxes">
        <MailboxesTab mailboxes={mailboxes} />
      </TabsContent>
      <TabsContent value="protection">
        <ProtectionTab initialPolicy={policy} counters={counters} canManage={canManage} />
      </TabsContent>
    </Tabs>
  );
}
