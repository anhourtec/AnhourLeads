"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Check, Copy, KeyRound, Plus, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-fetch";
import { outranksOrEquals, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, type Role } from "@/lib/rbac/permissions";

interface CreateResponse {
  api_key: { id: string; name: string; prefix: string; role: Role };
  secret: string;
}

export function CreateKeyDialog({ role }: { readonly role: Role }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const roles = ROLES.filter((r) => outranksOrEquals(role, r));
  const [selected, setSelected] = useState<Role>("viewer");
  const [created, setCreated] = useState<CreateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setCreated(null);
    setCopied(false);
    setError(null);
    setFields({});
    setSelected("viewer");
  }

  async function submit(form: FormData) {
    setPending(true);
    setError(null);
    setFields({});
    const res = await apiFetch<CreateResponse>("/api/v1/api_keys", {
      body: { name: String(form.get("name") ?? "").trim(), role: selected },
    });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      setFields(res.fields);
      return;
    }
    setCreated(res.data);
    router.refresh();
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.secret);
      setCopied(true);
      toast.success("Key copied");
    } catch {
      toast.error("Couldn't copy. Select the key and copy it yourself.");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus data-icon="inline-start" />
          Create API key
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your new key</DialogTitle>
              <DialogDescription>
                "{created.api_key.name}" can do what a {ROLE_LABELS[created.api_key.role].toLowerCase()} can. Send it in
                the <span className="font-mono">X-Api-Key</span> header.
              </DialogDescription>
            </DialogHeader>
            <Alert>
              <TriangleAlert aria-hidden="true" />
              <AlertTitle>You won't see this key again</AlertTitle>
              <AlertDescription>
                Store it somewhere safe now. If you lose it, revoke it and create a new one.
              </AlertDescription>
            </Alert>
            <div className="flex items-stretch gap-2">
              <code
                className="min-w-0 flex-1 select-all break-all rounded-lg border bg-muted px-2.5 py-2 font-mono text-xs"
                data-testid="api-key-secret"
              >
                {created.secret}
              </code>
              <Button type="button" variant="outline" size="sm" className="h-auto" onClick={() => void copy()}>
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" size="sm">
                  <Check data-icon="inline-start" />
                  Done
                </Button>
              </DialogClose>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create an API key</DialogTitle>
              <DialogDescription>
                Keys act for this workspace with the role you choose, up to your own.
              </DialogDescription>
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
              <FieldGroup className="gap-4">
                <Field data-invalid={Boolean(fields.name)}>
                  <FieldLabel htmlFor="key-name">Name</FieldLabel>
                  <Input
                    id="key-name"
                    name="name"
                    required
                    maxLength={80}
                    placeholder="CRM sync"
                    aria-invalid={Boolean(fields.name)}
                  />
                  {fields.name ? <FieldError>{fields.name}</FieldError> : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="key-role">Role</FieldLabel>
                  <NativeSelect
                    id="key-role"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value as Role)}
                    className="w-full"
                  >
                    {roles.map((r) => (
                      <NativeSelectOption key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldDescription>{ROLE_DESCRIPTIONS[selected]}</FieldDescription>
                </Field>
              </FieldGroup>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline" size="sm" disabled={pending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" size="sm" disabled={pending}>
                  <KeyRound data-icon="inline-start" />
                  {pending ? "Creating…" : "Create key"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
