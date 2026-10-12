"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Download, Eraser } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api-fetch";

interface EraseResponse {
  deleted: { contacts: number; enrollments: number; messages: number };
}

/** Data-subject requests: export everything held about an address, or erase it. */
export function DataRequests({ canErase, canExport }: { readonly canErase: boolean; readonly canExport: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState<string | null>(null);
  const trimmed = email.trim().toLowerCase();
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);

  async function exportData() {
    setExporting(true);
    setError(null);
    const res = await apiFetch<Record<string, unknown>>(`/api/v1/privacy/export?email=${encodeURIComponent(trimmed)}`);
    setExporting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `data-export-${trimmed.replace(/[^a-z0-9.@-]/g, "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Export downloaded");
  }

  async function erase() {
    setErasing(true);
    setEraseError(null);
    const res = await apiFetch<EraseResponse>("/api/v1/privacy/erase", { body: { email: trimmed } });
    setErasing(false);
    if (!res.ok) {
      setEraseError(res.error);
      return;
    }
    const n = res.data.deleted.contacts;
    toast.success(`Erased ${n} ${n === 1 ? "record" : "records"}. The address stays blocked.`);
    setEraseOpen(false);
    setConfirm("");
    setEmail("");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data requests</CardTitle>
        <CardDescription>
          When someone asks what you hold about them, or asks you to delete it. Erasing keeps the address on this list
          so it's never imported again.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor="dsr-email">Email address</FieldLabel>
          <Input
            id="dsr-email"
            type="email"
            className="font-mono"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(error)}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <div className="flex flex-wrap gap-2">
          {canExport ? (
            <Button size="sm" variant="outline" disabled={!valid || exporting} onClick={() => void exportData()}>
              <Download data-icon="inline-start" />
              {exporting ? "Exporting…" : "Export data"}
            </Button>
          ) : null}
          {canErase ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={!valid}
              onClick={() => {
                setConfirm("");
                setEraseError(null);
                setEraseOpen(true);
              }}
            >
              <Eraser data-icon="inline-start" />
              Erase person
            </Button>
          ) : null}
        </div>
      </CardContent>

      <Dialog open={eraseOpen} onOpenChange={(next) => !erasing && setEraseOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Erase everything about this person?</DialogTitle>
            <DialogDescription>
              Every person record with this address is deleted, with its sources, list memberships, sequence enrollments
              and sent-message log. Only a do-not-contact entry remains. This can't be undone.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void erase();
            }}
          >
            {eraseError ? (
              <Alert variant="destructive">
                <AlertDescription>{eraseError}</AlertDescription>
              </Alert>
            ) : null}
            <Field>
              <FieldLabel htmlFor="dsr-confirm">Type the address to confirm</FieldLabel>
              <Input
                id="dsr-confirm"
                className="font-mono"
                autoComplete="off"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={trimmed}
              />
              <FieldDescription className="break-all font-mono text-xs">{trimmed}</FieldDescription>
            </Field>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" size="sm" disabled={erasing}>
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={erasing || confirm.trim().toLowerCase() !== trimmed}
              >
                <Eraser data-icon="inline-start" />
                {erasing ? "Erasing…" : "Erase permanently"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
