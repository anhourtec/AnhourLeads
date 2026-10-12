import Link from "next/link";

import { FileSpreadsheet, Search, Workflow } from "lucide-react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { can } from "@/lib/rbac/permissions";
import { orNotFound, pageActor } from "@/server/services/engage-context";
import { getList } from "@/server/services/lists";
import { loadSearchPage } from "@/server/services/search-page";

import { SearchShell } from "../../_components/records/search/search-shell";
import { ListActions } from "./_components/list-actions";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { actor } = await pageActor("list:read");
  const list = await orNotFound(getList(actor, (await params).id));
  return { title: list.name };
}

function ActionCard({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className="flex w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring sm:w-48"
    >
      <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">{icon}</span>
      <span className="font-medium text-sm">{title}</span>
      <span className="text-muted-foreground text-xs">{description}</span>
    </Link>
  );
}

/** A list: the same search screen as people or companies, limited to the list's records. */
export default async function ListPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const { actor } = await pageActor("list:read");
  const { id } = await params;
  const list = await orNotFound(getList(actor, id));
  const entity = list.entityType;
  const data = await loadSearchPage(actor, entity, await searchParams, { fixed: { listId: [list.id] } });
  const canUpdate = can(actor.role, "list:update");
  const isPeople = entity === "contact";
  const importType = isPeople ? "contacts" : "accounts";

  return (
    <SearchShell
      ctx={{
        entity,
        basePath: `/dashboard/lists/${list.id}`,
        fixed: { listId: [list.id] },
        currentUserId: actor.userId ?? "",
      }}
      breadcrumb={
        <nav aria-label="Breadcrumb" className="text-muted-foreground text-xs">
          <ol className="flex items-center gap-1.5">
            <li>
              <Link href="/dashboard/lists" className="hover:underline">
                Lists
              </Link>
            </li>
            <li aria-hidden="true">›</li>
            <li className="truncate text-foreground" aria-current="page">
              {list.name}
            </li>
          </ol>
        </nav>
      }
      title={list.name}
      titleAddon={
        <>
          <Badge variant="secondary" className="bg-sky-500/10 font-medium text-sky-700 dark:text-sky-400">
            {isPeople ? "People" : "Companies"}
          </Badge>
          {list.kind === "dynamic" ? (
            <Badge variant="outline" className="font-medium">
              Dynamic
            </Badge>
          ) : null}
        </>
      }
      headerExtra={
        <p className="text-muted-foreground text-sm">
          <span className="font-mono tabular-nums">{list.memberCount.toLocaleString("en-US")}</span>{" "}
          {list.memberCount === 1 ? "record" : "records"}
          {list.kind === "dynamic" ? " · updates itself from its filters" : ""}
        </p>
      }
      headerActions={
        <ListActions
          list={list}
          canUpdate={canUpdate}
          canDelete={can(actor.role, "list:delete")}
          options={data.options}
          permissions={data.permissions}
        />
      }
      alwaysShowResults
      staticListId={list.kind === "static" ? list.id : undefined}
      emptyState={
        <div className="flex flex-col items-center gap-4 px-4 py-16 text-center">
          <div className="flex flex-col gap-1">
            <p className="font-medium">No records</p>
            <p className="text-muted-foreground text-sm">
              {list.kind === "dynamic"
                ? "Nothing matches this list's filters yet."
                : `No saved ${isPeople ? "people" : "companies"} yet. Add some to get started.`}
            </p>
          </div>
          <div className="flex w-full flex-col justify-center gap-3 sm:w-auto sm:flex-row">
            <ActionCard
              href={isPeople ? "/dashboard/people" : "/dashboard/companies"}
              icon={<Search className="size-4" aria-hidden="true" />}
              title={isPeople ? "Find people" : "Find companies"}
              description="Search your records and add them to this list."
            />
            <ActionCard
              href={`/dashboard/import?type=${importType}&listId=${list.id}`}
              icon={<FileSpreadsheet className="size-4" aria-hidden="true" />}
              title="Import by CSV"
              description="Import records into this list from a CSV file."
            />
            <ActionCard
              href={`/dashboard/workflows/new?from=list&listId=${list.id}`}
              icon={<Workflow className="size-4" aria-hidden="true" />}
              title="Create workflow"
              description="Add matching saved records to this list automatically."
            />
          </div>
        </div>
      }
      {...data}
    />
  );
}
