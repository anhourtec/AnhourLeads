"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { FileUp, Upload } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatNumber } from "@/lib/format-display";
import type { PipelineDto } from "@/server/services/pipelines";

interface Report {
  total: number;
  created: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

const COLUMNS = ["Deal name", "Company domain", "Contact email", "Amount", "Stage", "Close date", "Owner email"];

/** Import deals from a CSV file into one pipeline (deal:create). */
export function ImportDealsDialog({
  pipelines,
  defaultPipelineId,
}: {
  readonly pipelines: PipelineDto[];
  readonly defaultPipelineId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pipelineId, setPipelineId] = useState(defaultPipelineId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function upload() {
    if (!file) return;
    setPending(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    try {
      const res = await fetch(`/api/v1/opportunities/import?pipelineId=${encodeURIComponent(pipelineId)}`, {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => ({}))) as {
        import?: Report;
        error?: string;
        details?: { message?: string }[];
      };
      if (!res.ok || !body.import) {
        setError(body.details?.[0]?.message ?? body.error ?? "The file couldn't be imported.");
        return;
      }
      setReport(body.import);
      toast.success(`${formatNumber(body.import.created)} deals imported`);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <FileUp data-icon="inline-start" />
        Import CSV
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (!next) {
            setReport(null);
            setFile(null);
            setError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import deals</DialogTitle>
            <DialogDescription>
              Upload a CSV with a header row. Companies and people are matched by domain and email in this workspace.
            </DialogDescription>
          </DialogHeader>
          {report ? (
            <div className="flex flex-col gap-3 text-sm">
              <p>
                <span className="font-mono tabular-nums">{formatNumber(report.created)}</span> of{" "}
                <span className="font-mono tabular-nums">{formatNumber(report.total)}</span> rows imported
                {report.skipped ? `, ${formatNumber(report.skipped)} skipped` : ""}.
              </p>
              {report.errors.length ? (
                <ul className="max-h-48 overflow-y-auto rounded-lg border p-3 text-xs">
                  {report.errors.map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      Row <span className="font-mono">{e.row}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Field>
                <FieldLabel htmlFor="import-file">CSV file</FieldLabel>
                <Input
                  id="import-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <FieldDescription>
                  Columns: <span className="font-mono text-xs">{COLUMNS.join(", ")}</span>. Up to 5 MB.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="import-pipeline">Pipeline</FieldLabel>
                <NativeSelect
                  id="import-pipeline"
                  value={pipelineId}
                  onChange={(e) => setPipelineId(e.target.value)}
                  className="w-full"
                >
                  {pipelines.map((p) => (
                    <NativeSelectOption key={p.id} value={p.id}>
                      {p.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>Stage names in the file must match this pipeline's stages.</FieldDescription>
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" disabled={pending} onClick={() => setOpen(false)}>
              {report ? "Done" : "Cancel"}
            </Button>
            {!report ? (
              <Button size="sm" disabled={!file || pending} onClick={() => void upload()}>
                <Upload data-icon="inline-start" />
                {pending ? "Importing…" : "Import"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
