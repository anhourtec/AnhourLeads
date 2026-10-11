"use client";

import { useState } from "react";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { formatDistanceToNow } from "date-fns";
import { Building2, ListChecks, Plus, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { NewListSheet } from "./new-list-sheet";
import type { FilterPickerData, ListPermissions, ListRow } from "./types";

const HEAD =
  "border-b px-4 py-2 text-left font-mono font-normal text-[11px] text-muted-foreground uppercase tracking-wider";

function ListsTable({ lists, caption }: { lists: ListRow[]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={HEAD}>
              Name
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Records
            </th>
            <th scope="col" className={HEAD}>
              Type
            </th>
            <th scope="col" className={HEAD}>
              Owner
            </th>
            <th scope="col" className={`${HEAD} text-right`}>
              Updated
            </th>
          </tr>
        </thead>
        <tbody>
          {lists.map((list) => (
            <tr key={list.id} className="hover:bg-muted/40">
              <td className="max-w-80 border-b px-4 py-3">
                <Link
                  href={`/dashboard/lists/${list.id}`}
                  className="block truncate font-medium underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground"
                >
                  {list.name}
                </Link>
              </td>
              <td className="border-b px-4 py-3 text-right font-mono tabular-nums">
                {list.memberCount.toLocaleString("en-US")}
              </td>
              <td className="border-b px-4 py-3">
                <Badge
                  variant="secondary"
                  className={
                    list.kind === "dynamic" ? "bg-sky-500/10 font-medium text-sky-700 dark:text-sky-400" : "font-medium"
                  }
                >
                  {list.kind === "dynamic" ? "Dynamic" : "Static"}
                </Badge>
              </td>
              <td className="border-b px-4 py-3">
                {list.ownerName ?? <span className="text-muted-foreground">—</span>}
              </td>
              <td
                className="border-b px-4 py-3 text-right text-muted-foreground text-xs"
                title={new Date(list.updatedAt).toLocaleString()}
                suppressHydrationWarning
              >
                {formatDistanceToNow(new Date(list.updatedAt), { addSuffix: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** My lists: people and company lists in tabs, most recently updated first. */
export function ListsView({
  lists,
  permissions,
  picker,
}: {
  lists: ListRow[];
  permissions: ListPermissions;
  picker: FilterPickerData;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const type = params.get("type") === "company" ? "company" : "contact";
  const [sheet, setSheet] = useState<"contact" | "company" | null>(null);
  const people = lists.filter((l) => l.entityType === "contact");
  const companies = lists.filter((l) => l.entityType === "company");
  const shown = type === "contact" ? people : companies;
  const TypeIcon = type === "contact" ? UserRound : Building2;

  let body: React.ReactNode;
  if (!lists.length) {
    body = (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListChecks aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>Start your first list</EmptyTitle>
          <EmptyDescription>
            Lists keep the people and companies you're targeting in one place, ready for sequences and exports.
          </EmptyDescription>
        </EmptyHeader>
        {permissions.create ? (
          <EmptyContent className="flex-row flex-wrap justify-center">
            <Button variant="outline" size="sm" onClick={() => setSheet("contact")}>
              <UserRound data-icon="inline-start" aria-hidden="true" />
              Create a people list
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSheet("company")}>
              <Building2 data-icon="inline-start" aria-hidden="true" />
              Create a company list
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <Tabs
          value={type}
          onValueChange={(v) =>
            router.replace(v === "company" ? `${pathname}?type=company` : pathname, { scroll: false })
          }
        >
          <TabsList>
            <TabsTrigger value="contact">
              People lists <span className="font-mono text-muted-foreground tabular-nums">{people.length}</span>
            </TabsTrigger>
            <TabsTrigger value="company">
              Company lists <span className="font-mono text-muted-foreground tabular-nums">{companies.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {shown.length ? (
          <ListsTable lists={shown} caption={type === "contact" ? "People lists" : "Company lists"} />
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TypeIcon aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No {type === "contact" ? "people" : "company"} lists yet</EmptyTitle>
              <EmptyDescription>Create one to start collecting records.</EmptyDescription>
            </EmptyHeader>
            {permissions.create ? (
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={() => setSheet(type)}>
                  <Plus data-icon="inline-start" aria-hidden="true" />
                  {type === "contact" ? "Create a people list" : "Create a company list"}
                </Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="font-medium text-2xl tracking-tight">My lists</h1>
          <p className="text-muted-foreground text-sm">
            Group people and companies to work on together. Lists built from filters keep themselves up to date.
          </p>
        </div>
        {permissions.create ? (
          <Button size="sm" onClick={() => setSheet(type)}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            Create list
          </Button>
        ) : null}
      </div>
      {body}
      {permissions.create ? (
        <NewListSheet
          open={sheet !== null}
          onOpenChange={(o) => !o && setSheet(null)}
          defaultTarget={sheet ?? "contact"}
          picker={picker}
        />
      ) : null}
    </div>
  );
}
