"use client";

import { useState } from "react";

import { Repeat, Save } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/api-fetch";
import type { AutomationView } from "@/server/services/enrichment-jobs";

export function AutomateDialog({
  automation,
  onSaved,
}: {
  automation: AutomationView;
  onSaved: (next: AutomationView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(automation.enabled);
  const [verify, setVerify] = useState(String(automation.verifyOlderThanDays));
  const [recrawl, setRecrawl] = useState(String(automation.recrawlOlderThanDays));
  const [every, setEvery] = useState(String(automation.everyDays));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const save = async () => {
    const values = [Number(verify), Number(recrawl), Number(every)];
    const ranges: Array<[number, number]> = [
      [7, 365],
      [7, 365],
      [1, 90],
    ];
    if (enabled && values.some((v, i) => !Number.isInteger(v) || v < ranges[i][0] || v > ranges[i][1])) {
      setError("Use whole days: 7 to 365 for the age limits, and 1 to 90 for how often it runs.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await apiFetch<{ automation: AutomationView }>("/api/v1/enrichment_automation", {
      method: "PUT",
      body: {
        enabled,
        verifyOlderThanDays: Number(verify),
        recrawlOlderThanDays: Number(recrawl),
        everyDays: Number(every),
      },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved(res.data.automation);
    toast.success(enabled ? "Scheduled enrichment is on." : "Scheduled enrichment is off.");
    setOpen(false);
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, help: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={365}
        value={value}
        onChange={(e) => set(e.target.value)}
        disabled={!enabled}
        className="font-mono tabular-nums"
      />
      <p className="text-muted-foreground text-xs">{help}</p>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Repeat data-icon="inline-start" aria-hidden="true" />
          Automate enrichment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Automate enrichment</DialogTitle>
          <DialogDescription>
            Keep records fresh on a schedule. Old email results are checked again and companies are re-crawled from
            their public website.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
            <Label htmlFor="automation-enabled" className="flex flex-col items-start gap-0.5">
              <span>Scheduled enrichment</span>
              <span className="font-normal text-muted-foreground text-xs">
                Runs in the background for this workspace.
              </span>
            </Label>
            <Switch id="automation-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>
          {field("automation-verify", "Re-verify emails older than (days)", verify, setVerify, "From 7 to 365 days.")}
          {field(
            "automation-recrawl",
            "Re-crawl companies older than (days)",
            recrawl,
            setRecrawl,
            "From 7 to 365 days.",
          )}
          {field("automation-every", "Run every (days)", every, setEvery, "From 1 to 90 days.")}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            <Save data-icon="inline-start" aria-hidden="true" />
            {pending ? "Saving…" : "Save schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
