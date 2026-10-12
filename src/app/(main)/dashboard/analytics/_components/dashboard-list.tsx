"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { LayoutDashboard, Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/lib/api-fetch";

import { Pill } from "../../_components/pipeline/pills";

export interface DashboardSummary {
  id: string;
  name: string;
  kind: "system" | "custom" | "home";
  ownerName: string | null;
  starred: boolean;
  shared: boolean;
  widgetCount: number;
  updatedAt: string;
}

/** Star / unstar a dashboard (dashboard:manage). */
export function StarButton({
  dashboard,
  canManage,
}: {
  dashboard: Pick<DashboardSummary, "id" | "name" | "starred">;
  canManage: boolean;
}) {
  const router = useRouter();
  const [starred, setStarred] = useState(dashboard.starred);
  const [busy, setBusy] = useState(false);
  const label = starred ? `Unstar ${dashboard.name}` : `Star ${dashboard.name}`;

  if (!canManage) {
    return starred ? <Star className="size-4 fill-current text-amber-500" aria-label="Starred" role="img" /> : null;
  }

  async function toggle() {
    setBusy(true);
    const res = await apiFetch(`/api/v1/dashboards/${dashboard.id}`, { method: "PATCH", body: { starred: !starred } });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setStarred(!starred);
    router.refresh();
  }

  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      aria-pressed={starred}
      disabled={busy}
      onClick={toggle}
    >
      <Star className={starred ? "fill-current text-amber-500" : ""} aria-hidden="true" />
    </Button>
  );
}

export function DashboardList({ dashboards, canManage }: { dashboards: DashboardSummary[]; canManage: boolean }) {
  if (!dashboards.length) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LayoutDashboard aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No dashboards yet</EmptyTitle>
          <EmptyDescription>Dashboards collect the charts and numbers your team checks every week.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <span className="sr-only">Star</span>
            </TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead className="text-right">Widgets</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {dashboards.map((d) => (
            <TableRow key={d.id}>
              <TableCell>
                <StarButton dashboard={d} canManage={canManage} />
              </TableCell>
              <TableCell className="font-medium">
                <Link href={`/dashboard/analytics/dashboards/${d.id}`} className="hover:underline">
                  {d.name}
                </Link>
              </TableCell>
              <TableCell>
                {d.kind === "system" ? (
                  <Pill tone="neutral">System</Pill>
                ) : (
                  <Pill tone={d.shared ? "info" : "neutral"}>{d.shared ? "Shared" : "Private"}</Pill>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {d.kind === "system" ? "Workspace" : (d.ownerName ?? "Former member")}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{d.widgetCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
