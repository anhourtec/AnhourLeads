"use client";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useUrlFilters } from "../../_components/pipeline/use-url-filters";

/** All emails / Templates / Analytics, kept in `?tab=`. Switching tabs clears the list filters. */
export function EmailsTabs({ value }: { value: "emails" | "templates" | "analytics" }) {
  const filters = useUrlFilters();
  return (
    <Tabs
      value={value}
      onValueChange={(v) =>
        filters.set({ tab: v === "emails" ? null : v, status: null, q: null, sequence: null, oneOff: null })
      }
    >
      <TabsList>
        <TabsTrigger value="emails">All emails</TabsTrigger>
        <TabsTrigger value="templates">Templates</TabsTrigger>
        <TabsTrigger value="analytics">Analytics</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
