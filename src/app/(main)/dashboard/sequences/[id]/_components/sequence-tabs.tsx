"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useUrlParams } from "../../../_components/records/use-url-params";

type Tab = "steps" | "enrolled" | "review" | "settings";

/** Tab state lives in `?tab=` so refreshes after an action keep the current tab. */
export function SequenceTabs({
  value,
  counts,
  steps,
  enrolled,
  review,
  settings,
}: {
  value: Tab;
  counts: { steps: number; enrolled: number; review: number };
  steps: React.ReactNode;
  enrolled: React.ReactNode;
  review: React.ReactNode;
  settings: React.ReactNode;
}) {
  const { hrefWith } = useUrlParams();
  const [tab, setTab] = useState<Tab>(value);
  const count = (n: number) => <span className="font-mono text-muted-foreground text-xs tabular-nums">{n}</span>;

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        const t = next as Tab;
        setTab(t);
        window.history.replaceState(null, "", hrefWith({ tab: t === "steps" ? null : t, page: null }));
      }}
      className="gap-4"
    >
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <TabsList>
          <TabsTrigger value="steps">Steps {count(counts.steps)}</TabsTrigger>
          <TabsTrigger value="enrolled">Enrolled {count(counts.enrolled)}</TabsTrigger>
          <TabsTrigger value="review">Review queue {count(counts.review)}</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="steps">{steps}</TabsContent>
      <TabsContent value="enrolled">{enrolled}</TabsContent>
      <TabsContent value="review">{review}</TabsContent>
      <TabsContent value="settings">{settings}</TabsContent>
    </Tabs>
  );
}
