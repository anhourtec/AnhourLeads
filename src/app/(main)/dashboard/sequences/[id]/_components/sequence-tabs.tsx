"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useUrlParams } from "../../../_components/records/use-url-params";
import { SEQUENCE_TABS, type SequenceTab } from "./tabs";

const LABELS: Record<SequenceTab, string> = {
  editor: "Editor",
  contacts: "Contacts",
  activity: "Activity",
  health: "Health",
  report: "Report",
  settings: "Settings",
};

/**
 * Tab state lives in `?tab=` so refreshes keep the current tab. The editor stays mounted while other
 * tabs are open so unsaved step changes aren't lost by looking at another tab.
 */
export function SequenceTabs({
  value,
  contactsCount,
  panels,
}: {
  value: SequenceTab;
  contactsCount: number;
  panels: Record<SequenceTab, React.ReactNode>;
}) {
  const { hrefWith } = useUrlParams();
  const [tab, setTab] = useState<SequenceTab>(value);

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        const t = next as SequenceTab;
        setTab(t);
        window.history.replaceState(null, "", hrefWith({ tab: t === "editor" ? null : t, page: null }));
      }}
      className="gap-4"
    >
      <div className="-mx-4 overflow-x-auto border-b px-4 md:mx-0 md:px-0">
        <TabsList variant="line">
          {SEQUENCE_TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {LABELS[t]}
              {t === "contacts" ? (
                <span className="font-mono text-muted-foreground text-xs tabular-nums">
                  {contactsCount.toLocaleString("en-US")}
                </span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {SEQUENCE_TABS.map((t) => (
        <TabsContent
          key={t}
          value={t}
          forceMount={t === "editor" ? true : undefined}
          className={t === "editor" ? "data-[state=inactive]:hidden" : undefined}
        >
          {panels[t]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
