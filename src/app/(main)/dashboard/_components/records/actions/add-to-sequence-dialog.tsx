"use client";

import { useEffect, useId, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

import { apiRequest } from "../api-client";

interface SequenceOption {
  id: string;
  name: string;
  status: string;
}

interface EnrollResponse {
  enrolled_contact_ids: string[];
  skipped: { contactId: string; reason: string; message: string }[];
}

const CHUNK = 1000;

/** Enroll people in a sequence; reports how many were skipped and why (no email, suppressed…). */
export function AddToSequenceDialog({
  open,
  onOpenChange,
  contactIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactIds: string[];
  onDone?: () => void;
}) {
  const router = useRouter();
  const id = useId();
  const [sequences, setSequences] = useState<SequenceOption[] | null>(null);
  const [sequenceId, setSequenceId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ message: string; count: number }[]>([]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSkipped([]);
    let cancelled = false;
    void apiRequest<{ emailer_campaigns: SequenceOption[] }>("/api/v1/emailer_campaigns/search", {
      body: { per_page: 100 },
    }).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setSequences([]);
        return;
      }
      const usable = res.data.emailer_campaigns.filter((s) => s.status !== "archived");
      setSequences(usable);
      setSequenceId(usable[0]?.id ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    let enrolled = 0;
    const reasons = new Map<string, number>();
    for (let i = 0; i < contactIds.length; i += CHUNK) {
      const res = await apiRequest<EnrollResponse>(`/api/v1/emailer_campaigns/${sequenceId}/add_contact_ids`, {
        body: { contactIds: contactIds.slice(i, i + CHUNK) },
      });
      if (!res.ok) {
        setPending(false);
        setError(res.error);
        return;
      }
      enrolled += res.data.enrolled_contact_ids.length;
      for (const s of res.data.skipped) reasons.set(s.message, (reasons.get(s.message) ?? 0) + 1);
    }
    setPending(false);
    const name = sequences?.find((s) => s.id === sequenceId)?.name ?? "the sequence";
    if (enrolled) toast.success(`Added ${enrolled.toLocaleString("en-US")} to ${name}.`);
    router.refresh();
    onDone?.();
    if (reasons.size) {
      setSkipped([...reasons.entries()].map(([message, count]) => ({ message, count })));
      if (!enrolled) setError("Nobody could be added.");
      return;
    }
    onOpenChange(false);
  }

  const loading = sequences === null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add to sequence</DialogTitle>
            <DialogDescription>
              Enroll <span className="font-mono tabular-nums">{contactIds.length.toLocaleString("en-US")}</span>{" "}
              {contactIds.length === 1 ? "person" : "people"}. People without a usable email, or on the do-not-contact
              list, are skipped.
            </DialogDescription>
          </DialogHeader>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading sequences…</p>
          ) : sequences?.length ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-sequence`}>Sequence</Label>
              <NativeSelect id={`${id}-sequence`} value={sequenceId} onChange={(e) => setSequenceId(e.target.value)}>
                {sequences.map((s) => (
                  <NativeSelectOption key={s.id} value={s.id}>
                    {s.name} ({s.status})
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              There are no sequences yet.{" "}
              <Link href="/dashboard/sequences" className="text-primary underline-offset-4 hover:underline">
                Create one
              </Link>{" "}
              first.
            </p>
          )}
          {skipped.length ? (
            <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
              <p className="font-medium">Skipped</p>
              <ul className="flex flex-col gap-0.5 text-muted-foreground text-xs">
                {skipped.map((s) => (
                  <li key={s.message}>
                    <span className="font-mono tabular-nums">{s.count}</span> · {s.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {skipped.length ? "Close" : "Cancel"}
            </Button>
            <Button type="submit" size="sm" disabled={pending || !sequenceId || skipped.length > 0}>
              <Send data-icon="inline-start" aria-hidden="true" />
              {pending ? "Adding…" : "Add to sequence"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
