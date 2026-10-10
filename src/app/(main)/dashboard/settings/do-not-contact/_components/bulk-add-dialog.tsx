"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { ListPlus, ShieldBan } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api-fetch";
import { SUPPRESSION_REASON_LABELS } from "@/lib/pipeline-constants";

const REASONS = ["manual", "unsubscribed", "bounced", "complaint"] as const;
const MAX = 1000;

interface BulkResponse {
  created: number;
  existing: number;
  invalid: { line: string; error: string }[];
  affected: { contacts: number; enrollments: number };
}

export function BulkAddDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [result, setResult] = useState<BulkResponse | null>(null);
  const lines = text.split(/\r?\n|,|;/).filter((l) => l.trim()).length;

  async function submit(form: FormData) {
    setPending(true);
    setError(null);
    const res = await apiFetch<BulkResponse>("/api/v1/suppressions/bulk", {
      body: { text, reason: String(form.get("reason")) },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res.data);
    toast.success(`${res.data.created} added, ${res.data.existing} already listed`);
    router.refresh();
    if (!res.data.invalid.length) {
      setOpen(false);
      setText("");
      setResult(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setResult(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ListPlus data-icon="inline-start" />
          Add in bulk
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add in bulk</DialogTitle>
          <DialogDescription>Paste up to 1,000 email addresses or domains, one per line.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(new FormData(event.currentTarget));
          }}
        >
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {result?.invalid.length ? (
            <Alert>
              <AlertDescription>
                <p>
                  {result.created} added, {result.existing} already listed. These lines weren't valid:
                </p>
                <ul className="mt-1 max-h-24 overflow-y-auto font-mono text-xs">
                  {result.invalid.slice(0, 50).map((i) => (
                    <li key={i.line} className="truncate">
                      {i.line}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field data-invalid={lines > MAX}>
              <FieldLabel htmlFor="dnc-bulk">Entries</FieldLabel>
              <Textarea
                id="dnc-bulk"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                className="max-h-64 font-mono text-xs"
                placeholder={"name@example.com\ncompetitor.example"}
                aria-invalid={lines > MAX}
              />
              <FieldDescription>
                {lines} of {MAX} lines
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="dnc-bulk-reason">Reason</FieldLabel>
              <NativeSelect id="dnc-bulk-reason" name="reason" defaultValue="manual" className="w-full">
                {REASONS.map((r) => (
                  <NativeSelectOption key={r} value={r}>
                    {SUPPRESSION_REASON_LABELS[r]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={pending}>
                Close
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending || lines === 0 || lines > MAX}>
              <ShieldBan data-icon="inline-start" />
              {pending ? "Adding…" : "Add entries"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
