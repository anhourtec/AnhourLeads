import Link from "next/link";

import { formatDistanceToNow } from "date-fns";
import { ListChecks } from "lucide-react";

import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { TonePill } from "../../_components/engage/tone-pill";
import { ListFormDialog } from "./list-form-dialog";
import { ENTITY_LABELS, type ListPermissions, type ListRow } from "./types";

export function ListsTable({ lists, permissions }: { lists: ListRow[]; permissions: ListPermissions }) {
  if (lists.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListChecks aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No lists yet</EmptyTitle>
          <EmptyDescription>Lists group the people and companies you want to work on together.</EmptyDescription>
        </EmptyHeader>
        {permissions.create ? (
          <EmptyContent>
            <ListFormDialog mode="create" />
          </EmptyContent>
        ) : null}
      </Empty>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <Table className="min-w-[640px]">
        <TableHeader className="bg-muted/50">
          <TableRow>
            <TableHead className="px-4">Name</TableHead>
            <TableHead>Records</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead className="text-right">Members</TableHead>
            <TableHead className="px-4 text-right">Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lists.map((list) => (
            <TableRow key={list.id}>
              <TableCell className="max-w-80 px-4">
                <Link
                  href={`/dashboard/lists/${list.id}`}
                  className="block truncate font-medium underline-offset-4 hover:underline focus-visible:underline"
                >
                  {list.name}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">{ENTITY_LABELS[list.entityType]}</TableCell>
              <TableCell>
                <TonePill tone={list.kind === "dynamic" ? "info" : "neutral"}>
                  {list.kind === "dynamic" ? "Dynamic" : "Static"}
                </TonePill>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {list.memberCount.toLocaleString("en-US")}
              </TableCell>
              <TableCell
                className="px-4 text-right text-muted-foreground text-xs"
                title={new Date(list.updatedAt).toLocaleString()}
              >
                {formatDistanceToNow(new Date(list.updatedAt), { addSuffix: true })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
