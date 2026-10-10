"use client";

import { useId, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Building2, Check } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";

import { apiError } from "./format";

interface ApplyResult {
  company: { id: string; name: string; createdNow: boolean };
  fields: Array<{ field: string; action: "set" | "refreshed" | "kept_existing" }>;
  contacts: Array<{ name: string; status: "created" | "duplicate" | "suppressed" | "skipped" }>;
}

export function ApplyFindingsDialog({
  jobId,
  companyName,
  domain,
  peopleCount,
  canCreateContacts,
}: {
  jobId: string;
  companyName: string | null;
  domain: string | null;
  peopleCount: number;
  canCreateContacts: boolean;
}) {
  const router = useRouter();
  const checkboxId = useId();
  const [open, setOpen] = useState(false);
  const [createContacts, setCreateContacts] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyResult | null>(null);

  async function apply() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/crawl_jobs/${jobId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ createContacts: canCreateContacts && createContacts }),
      });
      if (!res.ok) {
        setError(await apiError(res, "The findings couldn't be applied."));
        return;
      }
      const body = (await res.json()) as ApplyResult;
      setResult(body);
      const set = body.fields.filter((f) => f.action === "set").length;
      toast.success(`Applied to ${body.company.name}`, {
        description: `${set} ${set === 1 ? "field" : "fields"} updated`,
      });
      router.refresh();
    } catch {
      setError("The findings couldn't be applied. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  const target = companyName ?? (domain ? `the company at ${domain}` : "a new company");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setResult(null);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Building2 data-icon="inline-start" />
          Apply to company
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply findings</DialogTitle>
          <DialogDescription>
            Fills in {target} with what this crawl found. Values someone entered by hand or found with higher confidence
            are kept. Every value records the page it came from.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-2 text-sm" aria-live="polite">
            <p>
              <span className="font-mono tabular-nums">{result.fields.filter((f) => f.action === "set").length}</span>{" "}
              fields updated,{" "}
              <span className="font-mono tabular-nums">
                {result.fields.filter((f) => f.action === "kept_existing").length}
              </span>{" "}
              kept.
              {result.contacts.length ? (
                <>
                  {" "}
                  <span className="font-mono tabular-nums">
                    {result.contacts.filter((c) => c.status === "created").length}
                  </span>{" "}
                  contacts added.
                </>
              ) : null}
            </p>
            <Link
              href={`/dashboard/companies/${result.company.id}`}
              className="w-fit text-primary underline-offset-4 hover:underline"
            >
              Open {result.company.name}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {canCreateContacts && peopleCount > 0 ? (
              <div className="flex items-start gap-2">
                <Checkbox
                  id={checkboxId}
                  checked={createContacts}
                  onCheckedChange={(v) => setCreateContacts(v === true)}
                />
                <Label htmlFor={checkboxId} className="font-normal leading-snug">
                  Also add the {peopleCount} {peopleCount === 1 ? "person" : "people"} found as contacts. Existing
                  contacts and anyone on the do-not-contact list are skipped.
                </Label>
              </div>
            ) : null}
            {error ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {result ? "Close" : "Cancel"}
            </Button>
          </DialogClose>
          {result ? null : (
            <Button size="sm" onClick={apply} disabled={pending}>
              <Check data-icon="inline-start" />
              {pending ? "Applying…" : "Apply"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
