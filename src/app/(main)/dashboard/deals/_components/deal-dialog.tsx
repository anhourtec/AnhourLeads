"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Plus, Save } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-fetch";
import { toDateInput } from "@/lib/format-display";
import { DEAL_STAGE_INFO, DEAL_STAGES, type DealStage } from "@/lib/pipeline-constants";
import type { DealDto } from "@/server/services/deals";

export interface MemberOption {
  id: string;
  name: string;
  email: string;
}

export function DealDialog({
  open,
  onOpenChange,
  deal,
  members,
  defaultOwnerId,
  defaultStage,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly deal: DealDto | null;
  readonly members: MemberOption[];
  readonly defaultOwnerId: string;
  readonly defaultStage: DealStage;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function submit(form: FormData) {
    setPending(true);
    setError(null);
    setFields({});
    const amount = String(form.get("amount") ?? "").replace(/[\s,]/g, "");
    const closeDate = String(form.get("closeDate") ?? "");
    const ownerId = String(form.get("ownerId") ?? "");
    const body = {
      name: String(form.get("name") ?? "").trim(),
      stage: String(form.get("stage")),
      amount: amount ? amount : null,
      currency: String(form.get("currency") ?? "USD"),
      closeDate: closeDate ? closeDate : null,
      ownerId: ownerId ? ownerId : null,
    };
    const res = await apiFetch(deal ? `/api/v1/opportunities/${deal.id}` : "/api/v1/opportunities", {
      method: deal ? "PATCH" : "POST",
      body,
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      setFields(res.fields);
      return;
    }
    toast.success(deal ? "Deal saved" : "Deal created");
    onOpenChange(false);
    router.refresh();
  }

  let submitLabel = deal ? "Save deal" : "Create deal";
  if (pending) submitLabel = "Saving…";

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{deal ? "Edit deal" : "New deal"}</DialogTitle>
          <DialogDescription>Track an opportunity through your pipeline.</DialogDescription>
        </DialogHeader>
        <form
          key={deal?.id ?? `new-${defaultStage}`}
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
          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(fields.name)}>
              <FieldLabel htmlFor="deal-name">Name</FieldLabel>
              <Input
                id="deal-name"
                name="name"
                required
                maxLength={200}
                defaultValue={deal?.name ?? ""}
                placeholder="Northwind — annual plan"
                aria-invalid={Boolean(fields.name)}
              />
              {fields.name ? <FieldError>{fields.name}</FieldError> : null}
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="deal-stage">Stage</FieldLabel>
                <NativeSelect
                  id="deal-stage"
                  name="stage"
                  defaultValue={deal?.stage ?? defaultStage}
                  className="w-full"
                >
                  {DEAL_STAGES.map((s) => (
                    <NativeSelectOption key={s} value={s}>
                      {DEAL_STAGE_INFO[s].name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="deal-owner">Owner</FieldLabel>
                <NativeSelect
                  id="deal-owner"
                  name="ownerId"
                  defaultValue={deal ? (deal.owner?.id ?? "") : defaultOwnerId}
                  className="w-full"
                >
                  <NativeSelectOption value="">No owner</NativeSelectOption>
                  {members.map((m) => (
                    <NativeSelectOption key={m.id} value={m.id}>
                      {m.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="grid grid-cols-[1fr_6rem] gap-3">
              <Field data-invalid={Boolean(fields.amount)}>
                <FieldLabel htmlFor="deal-amount">Amount</FieldLabel>
                <Input
                  id="deal-amount"
                  name="amount"
                  inputMode="numeric"
                  className="font-mono"
                  defaultValue={deal?.amount ?? ""}
                  placeholder="12000"
                  aria-invalid={Boolean(fields.amount)}
                />
                {fields.amount ? <FieldError>{fields.amount}</FieldError> : null}
              </Field>
              <Field data-invalid={Boolean(fields.currency)}>
                <FieldLabel htmlFor="deal-currency">Currency</FieldLabel>
                <Input
                  id="deal-currency"
                  name="currency"
                  maxLength={3}
                  className="font-mono uppercase"
                  defaultValue={deal?.currency ?? "USD"}
                  aria-invalid={Boolean(fields.currency)}
                />
              </Field>
            </div>
            <Field data-invalid={Boolean(fields.closeDate)}>
              <FieldLabel htmlFor="deal-close">Expected close date</FieldLabel>
              <Input id="deal-close" name="closeDate" type="date" defaultValue={toDateInput(deal?.closeDate)} />
              {fields.closeDate ? <FieldError>{fields.closeDate}</FieldError> : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={pending}>
              {deal ? <Save data-icon="inline-start" /> : <Plus data-icon="inline-start" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
