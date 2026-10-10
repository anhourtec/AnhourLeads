import Link from "next/link";

import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { can } from "@/lib/rbac/permissions";
import { pageFrom, pagination } from "@/server/http/route";
import { orNotFound, pageActor } from "@/server/services/engage-context";
import { getList, listMembers } from "@/server/services/lists";

import { PageHeader } from "../../_components/records/page-header";
import { RecordsPagination } from "../../_components/records/records-pagination";
import { SearchBox } from "../../_components/records/search-box";
import { ENTITY_LABELS } from "../_components/types";
import { FilterSummary } from "./_components/filter-summary";
import { ListActions } from "./_components/list-actions";
import { MembersTable } from "./_components/members-table";

export const metadata: Metadata = { title: "List" };

export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { actor } = await pageActor("list:read");
  const { id } = await params;
  const search = await searchParams;
  const q = typeof search.q === "string" ? search.q.slice(0, 200) : undefined;
  const page = pageFrom({ page: search.page, per_page: 25 });
  const list = await orNotFound(getList(actor, id));
  const members = await listMembers(actor, id, page, q);
  const canUpdate = can(actor.role, "list:update");
  const editable = list.kind === "static" && canUpdate;

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <div className="flex flex-col gap-2">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/dashboard/lists">
              <ArrowLeft data-icon="inline-start" aria-hidden="true" />
              Lists
            </Link>
          </Button>
        </div>
        <PageHeader
          title={<span className="break-words">{list.name}</span>}
          description={
            <span>
              {ENTITY_LABELS[list.entityType]} · {list.kind === "dynamic" ? "Dynamic" : "Static"} ·{" "}
              <span className="font-mono tabular-nums">{list.memberCount.toLocaleString("en-US")}</span>{" "}
              {list.memberCount === 1 ? "member" : "members"}
            </span>
          }
          actions={
            <ListActions list={list} canAdd={editable} canEdit={canUpdate} canDelete={can(actor.role, "list:delete")} />
          }
        />
      </div>
      {list.kind === "dynamic" ? <FilterSummary list={list} canEdit={canUpdate} /> : null}
      <div className="flex flex-col gap-3">
        <SearchBox placeholder="Search members" label="Search members" />
        <MembersTable listId={list.id} members={members} canRemove={editable} filtered={Boolean(q)} />
        {members.total > 0 ? <RecordsPagination pagination={pagination(page, members.total)} noun="members" /> : null}
      </div>
    </div>
  );
}
