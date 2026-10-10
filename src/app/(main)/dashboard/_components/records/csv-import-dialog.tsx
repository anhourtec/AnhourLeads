"use client";

import { useId, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { FileUp, Upload } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { apiRequest } from "./api-client";

interface ImportReport {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  companiesCreated?: number;
  errors: { row: number; message: string }[];
  columns: Record<string, string | null>;
}

/** Upload a CSV to an import endpoint and show what happened, row errors included. */
export function CsvImportDialog({
  endpoint,
  noun,
  dedupeHint,
  columnsHint,
}: {
  endpoint: string;
  noun: string;
  dedupeHint: string;
  columnsHint: string;
}) {
  const router = useRouter();
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  function reset() {
    setFile(null);
    setError(null);
    setReport(null);
    setUpdateExisting(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("The file is larger than 5 MB. Split it and import the parts.");
      return;
    }
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("updateExisting", String(updateExisting));
    const result = await apiRequest<ImportReport>(endpoint, { body: form });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setReport(result.data);
    toast.success(`Imported ${result.data.created + result.data.updated} ${noun}.`);
    router.refresh();
  }

  const mapped = report ? Object.entries(report.columns) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload data-icon="inline-start" aria-hidden="true" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import {noun} from CSV</DialogTitle>
          <DialogDescription>
            Up to 5,000 rows and 5 MB. {dedupeHint} Each imported value is recorded with the source csv_import.
          </DialogDescription>
        </DialogHeader>

        {report ? (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-3 gap-2">
              {(
                [
                  ["Created", report.created],
                  ["Updated", report.updated],
                  ["Skipped", report.skipped],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border p-3">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="font-medium font-mono text-xl tabular-nums">{value.toLocaleString("en-US")}</dd>
                </div>
              ))}
            </dl>
            {report.companiesCreated ? (
              <p className="text-muted-foreground text-sm">
                Also created <span className="font-mono tabular-nums">{report.companiesCreated}</span> companies from
                the company columns.
              </p>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-sm">Column mapping</p>
              <ul className="flex flex-col gap-1 text-xs">
                {mapped.map(([header, field]) => (
                  <li key={header} className="flex min-w-0 items-center justify-between gap-3">
                    <span className="truncate font-mono">{header}</span>
                    <span className={field ? "text-foreground" : "text-muted-foreground"}>{field ?? "Ignored"}</span>
                  </li>
                ))}
              </ul>
            </div>
            {report.errors.length ? (
              <div className="flex flex-col gap-1.5">
                <p className="font-medium text-sm">Rows that weren't imported</p>
                <ul className="max-h-40 overflow-y-auto rounded-lg border text-xs">
                  {report.errors.map((e) => (
                    <li key={`${e.row}-${e.message}`} className="flex gap-3 border-b px-3 py-1.5 last:border-b-0">
                      <span className="font-mono text-muted-foreground tabular-nums">Row {e.row}</span>
                      <span>{e.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={reset}>
                <FileUp data-icon="inline-start" aria-hidden="true" />
                Import another file
              </Button>
              <Button size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form noValidate onSubmit={submit} className="flex flex-col gap-4">
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup className="gap-4">
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${id}-file`}>CSV file</FieldLabel>
                <Input
                  ref={fileRef}
                  id={`${id}-file`}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <FieldDescription className="text-xs">{columnsHint}</FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-update`}
                  checked={updateExisting}
                  onCheckedChange={(checked) => setUpdateExisting(Boolean(checked))}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`${id}-update`} className="font-normal">
                    Update {noun} that are already in this workspace
                  </FieldLabel>
                </FieldContent>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="submit" size="sm" disabled={pending}>
                <Upload data-icon="inline-start" aria-hidden="true" />
                {pending ? "Importing…" : "Import"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
