"use client";

import { useRouter } from "next/navigation";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useUrlParams } from "../../_components/records/use-url-params";

export type ListTab = "all" | "analytics" | "diagnostics";

/** All sequences / Analytics / Diagnostics, kept in `?tab=`. */
export function ListTabs({ value, issues }: { value: ListTab; issues: number | null }) {
  const router = useRouter();
  const { hrefWith } = useUrlParams();
  return (
    <div className="-mx-4 overflow-x-auto border-b px-4 md:mx-0 md:px-0">
      <Tabs value={value} onValueChange={(next) => router.push(hrefWith({ tab: next === "all" ? null : next }))}>
        <TabsList variant="line">
          <TabsTrigger value="all">All sequences</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="diagnostics">
            Diagnostics
            {issues ? <span className="font-mono text-muted-foreground text-xs tabular-nums">{issues}</span> : null}
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
