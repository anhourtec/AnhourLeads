"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SnippetView, TemplateView } from "@/server/services/templates";

import { type LibraryAccess, LibraryManager } from "./library-manager";

export function TemplatesTabs({
  initialTab,
  templates,
  snippets,
  access,
}: {
  initialTab: "templates" | "snippets";
  templates: TemplateView[];
  snippets: SnippetView[];
  access: LibraryAccess;
}) {
  const [tab, setTab] = useState(initialTab);
  return (
    <Tabs
      value={tab}
      onValueChange={(v) => {
        const next = v === "snippets" ? "snippets" : "templates";
        setTab(next);
        window.history.replaceState(null, "", next === "snippets" ? "?tab=snippets" : window.location.pathname);
      }}
      className="gap-4"
    >
      <TabsList>
        <TabsTrigger value="templates">
          Templates <span className="font-mono text-muted-foreground text-xs tabular-nums">{templates.length}</span>
        </TabsTrigger>
        <TabsTrigger value="snippets">
          Snippets <span className="font-mono text-muted-foreground text-xs tabular-nums">{snippets.length}</span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="templates">
        <LibraryManager kind="template" items={templates} access={access} />
      </TabsContent>
      <TabsContent value="snippets">
        <LibraryManager kind="snippet" items={snippets.map((s) => ({ ...s, subject: null }))} access={access} />
      </TabsContent>
    </Tabs>
  );
}
