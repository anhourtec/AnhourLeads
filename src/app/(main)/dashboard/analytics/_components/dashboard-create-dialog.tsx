"use client";

import { useId, useState } from "react";

import { useRouter } from "next/navigation";

import { LayoutDashboard } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-fetch";

/** Name a new dashboard, then open it to add widgets. */
export function DashboardCreateDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const router = useRouter();
  const [name, setName] = useState("");
  const [shared, setShared] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const res = await apiFetch<{ dashboard: { id: string; name: string } }>("/api/v1/dashboards", {
      body: { name, shared },
    });
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    toast.success(`Created ${res.data.dashboard.name}`);
    onOpenChange(false);
    setName("");
    router.push(`/dashboard/analytics/dashboards/${res.data.dashboard.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create dashboard</DialogTitle>
            <DialogDescription>Start empty, then add the widgets your team needs.</DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>Name</Label>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={120}
              required
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id={`${id}-shared`} checked={shared} onCheckedChange={(v) => setShared(v === true)} />
            <Label htmlFor={`${id}-shared`} className="font-normal">
              Share with everyone in the workspace
            </Label>
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={saving || !name.trim()}>
              <LayoutDashboard data-icon="inline-start" aria-hidden="true" />
              {saving ? "Creating…" : "Create dashboard"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
