"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowLeft, LayoutDashboard, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { apiFetch } from "@/lib/api-fetch";
import type { DashboardDto } from "@/server/services/dashboards";

import { ConfirmDialog } from "../../_components/pipeline/confirm-dialog";
import { PageHeader } from "../../_components/pipeline/page-header";
import { Pill } from "../../_components/pipeline/pills";
import { StarButton } from "./dashboard-list";
import { WidgetAddDialog } from "./widget-add-dialog";
import { WidgetCard } from "./widget-card";
import type { Catalogue, Widget, WidgetData } from "./widget-format";

/** A dashboard: widgets in a responsive grid (KPIs one column, charts two). */
export function DashboardView({
  dashboard,
  data,
  catalogue,
  canManage,
}: {
  dashboard: DashboardDto;
  /** One promise per widget, streamed from the server so the page never waits for every query. */
  data: Record<string, Promise<WidgetData>>;
  catalogue: Catalogue;
  canManage: boolean;
}) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editable = canManage && dashboard.kind === "custom";

  async function saveWidgets(widgets: Widget[]): Promise<string | null> {
    const res = await apiFetch(`/api/v1/dashboards/${dashboard.id}`, { method: "PATCH", body: { widgets } });
    if (!res.ok) return res.error;
    router.refresh();
    return null;
  }

  async function addWidget(widget: Omit<Widget, "id">) {
    const failure = await saveWidgets([...dashboard.widgets, { ...widget, id: crypto.randomUUID() }]);
    if (!failure) toast.success("Widget added");
    return failure;
  }

  async function removeWidget(id: string) {
    const failure = await saveWidgets(dashboard.widgets.filter((w) => w.id !== id));
    if (failure) toast.error(failure);
  }

  async function toggleShare() {
    const res = await apiFetch(`/api/v1/dashboards/${dashboard.id}`, {
      method: "PATCH",
      body: { shared: !dashboard.shared },
    });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(dashboard.shared ? "Only you can see this dashboard now" : "Shared with the workspace");
    router.refresh();
  }

  async function remove(): Promise<boolean> {
    const res = await apiFetch(`/api/v1/dashboards/${dashboard.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    toast.success(`Deleted ${dashboard.name}`);
    router.push("/dashboard/analytics?tab=dashboards");
    return true;
  }

  return (
    <div className="flex flex-col gap-4 md:gap-6">
      <Button asChild size="sm" variant="ghost" className="w-fit">
        <Link href="/dashboard/analytics?tab=dashboards">
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          All dashboards
        </Link>
      </Button>
      <PageHeader
        title={dashboard.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {dashboard.kind === "system" ? (
              <>
                <Pill tone="neutral">System</Pill>
                <span>Built in for every workspace. Create your own dashboard to customise widgets.</span>
              </>
            ) : (
              <>
                <Pill tone={dashboard.shared ? "info" : "neutral"}>{dashboard.shared ? "Shared" : "Private"}</Pill>
                <span>Owner {dashboard.ownerName ?? "former member"}</span>
              </>
            )}
          </span>
        }
        actions={
          <>
            <StarButton dashboard={dashboard} canManage={canManage} />
            {editable ? (
              <>
                <Button size="sm" variant="outline" onClick={toggleShare}>
                  <Share2 data-icon="inline-start" aria-hidden="true" />
                  {dashboard.shared ? "Make private" : "Share"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}>
                  <Trash2 data-icon="inline-start" aria-hidden="true" />
                  Delete
                </Button>
                <WidgetAddDialog catalogue={catalogue} onAdd={addWidget} />
              </>
            ) : null}
          </>
        }
      />

      {dashboard.widgets.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {dashboard.widgets.map((widget) => (
            <WidgetCard
              key={widget.id}
              widget={widget}
              data={data[widget.id]}
              catalogue={catalogue}
              onRemove={editable ? () => void removeWidget(widget.id) : undefined}
            />
          ))}
        </div>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayoutDashboard aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No widgets yet</EmptyTitle>
            <EmptyDescription>
              {editable
                ? "Add a widget to track a metric over time, by rep, by sequence or as a single number."
                : "The owner hasn't added any widgets yet."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {editable ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${dashboard.name}?`}
          description="The dashboard and its widgets are removed for everyone. The data behind them stays."
          confirmLabel="Delete dashboard"
          pendingLabel="Deleting…"
          icon={<Trash2 data-icon="inline-start" aria-hidden="true" />}
          onConfirm={remove}
        />
      ) : null}
    </div>
  );
}
