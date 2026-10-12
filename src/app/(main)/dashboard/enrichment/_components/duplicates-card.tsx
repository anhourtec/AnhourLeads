"use client";

import { type ReactNode, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ChevronsUpDown, Merge } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { apiFetch } from "@/lib/api-fetch";
import type { DuplicateGroup } from "@/server/services/data-health";

import { ConfirmDialog } from "../../_components/pipeline/confirm-dialog";
import { Pill } from "../../_components/pipeline/pills";

const GROUPS_SHOWN = 8;
const RECORDS_SHOWN = 4;

const REASONS: Record<DuplicateGroup["reason"], string> = {
  same_email: "Same email",
  same_name_and_company: "Same name and company",
  same_domain: "Same domain",
  same_name: "Same company name",
};

export function DuplicatesCard({
  initialGroups,
  canMergeContacts,
  canMergeCompanies,
  icon,
  className,
}: {
  initialGroups: DuplicateGroup[];
  canMergeContacts: boolean;
  canMergeCompanies: boolean;
  icon: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState(initialGroups);
  const [target, setTarget] = useState<DuplicateGroup | null>(null);
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? groups : groups.slice(0, GROUPS_SHOWN);
  const kept = target?.records.find((r) => r.id === target.keepId);

  const merge = async () => {
    if (!target) return true;
    const res = await apiFetch<{ keptId: string }>("/api/v1/duplicates/merge", {
      body: { entityType: target.entityType, ids: target.records.map((r) => r.id), keepId: target.keepId },
    });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setGroups((current) => current.filter((g) => g.key !== target.key));
    toast.success(`Merged into ${kept?.name ?? "the kept record"}.`);
    router.refresh();
    return true;
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          Duplicates
        </CardTitle>
        <CardDescription>
          People with the same email or the same name at one company, and companies sharing a domain or name.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No duplicates found</EmptyTitle>
              <EmptyDescription>New duplicates show up here as you import and add records.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {visible.map((g) => {
              const canMerge = g.entityType === "contact" ? canMergeContacts : canMergeCompanies;
              return (
                <li key={g.key} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill tone="attention">{REASONS[g.reason]}</Pill>
                      <span className="text-muted-foreground text-xs">
                        {g.records.length} {g.entityType === "contact" ? "people" : "companies"}
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1">
                      {[...g.records]
                        .sort((a, b) => Number(b.id === g.keepId) - Number(a.id === g.keepId))
                        .slice(0, RECORDS_SHOWN)
                        .map((r) => (
                          <li key={r.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm">
                            <Link
                              href={`/dashboard/${g.entityType === "contact" ? "people" : "companies"}/${r.id}`}
                              className="truncate font-medium hover:underline"
                            >
                              {r.name}
                            </Link>
                            {r.detail ? (
                              <span className="truncate font-mono text-muted-foreground text-xs">{r.detail}</span>
                            ) : null}
                            <span className="text-muted-foreground text-xs">
                              {r.filledFields} fields filled{r.id === g.keepId ? " · kept on merge" : ""}
                            </span>
                          </li>
                        ))}
                      {g.records.length > RECORDS_SHOWN ? (
                        <li className="text-muted-foreground text-xs">and {g.records.length - RECORDS_SHOWN} more</li>
                      ) : null}
                    </ul>
                  </div>
                  {canMerge ? (
                    <Button size="sm" variant="outline" className="self-start" onClick={() => setTarget(g)}>
                      <Merge data-icon="inline-start" aria-hidden="true" />
                      Merge
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {groups.length > GROUPS_SHOWN ? (
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAll((v) => !v)}>
            <ChevronsUpDown data-icon="inline-start" aria-hidden="true" />
            {showAll ? "Show fewer" : `Show all ${groups.length} groups`}
          </Button>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={`Merge ${target?.records.length ?? 0} ${target?.entityType === "company" ? "companies" : "people"}`}
        description={
          <>
            <strong className="font-medium text-foreground">{kept?.name}</strong> is kept because it has the most filled
            fields. Its empty fields are filled from the others, and their lists,{" "}
            {target?.entityType === "company" ? "people" : "sequences"}, tasks, deals, notes and history move to it. The
            other records are then deleted. This can't be undone.
          </>
        }
        confirmLabel="Merge"
        pendingLabel="Merging…"
        icon={<Merge data-icon="inline-start" aria-hidden="true" />}
        onConfirm={merge}
      />
    </Card>
  );
}
