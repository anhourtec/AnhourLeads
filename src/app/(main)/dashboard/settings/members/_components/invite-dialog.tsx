"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Send, UserPlus } from "lucide-react";
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { apiFetch } from "@/lib/api-fetch";
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from "@/lib/rbac/permissions";

import { grantableRoles } from "./role-rules";

export function InviteDialog({ role, workspaceName }: { readonly role: Role; readonly workspaceName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const roles = grantableRoles(role);
  const [selected, setSelected] = useState<Role>(roles.includes("member") ? "member" : (roles.at(-1) ?? "viewer"));

  async function submit(form: FormData) {
    setPending(true);
    setError(null);
    setFields({});
    const email = String(form.get("email") ?? "").trim();
    const res = await apiFetch("/api/v1/users/invite", { body: { email, role: selected } });
    setPending(false);
    if (!res.ok) {
      setError(res.error);
      setFields(res.fields);
      return;
    }
    toast.success(`Invitation sent to ${email}`);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus data-icon="inline-start" />
          Invite member
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>
            They'll get an email with a link to join {workspaceName}. It expires in 7 days.
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
            <Field data-invalid={Boolean(fields.email)}>
              <FieldLabel htmlFor="invite-email">Email</FieldLabel>
              <Input
                id="invite-email"
                name="email"
                type="email"
                required
                autoComplete="off"
                className="font-mono"
                placeholder="name@company.com"
                aria-invalid={Boolean(fields.email)}
              />
              {fields.email ? <FieldError>{fields.email}</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel htmlFor="invite-role">Role</FieldLabel>
              <NativeSelect
                id="invite-role"
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
              <Send data-icon="inline-start" />
              {pending ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
