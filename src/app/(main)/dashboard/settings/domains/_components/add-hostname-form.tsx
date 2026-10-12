"use client";

import { useState } from "react";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface AddHostnameFormProps {
  disabled: boolean;
  onAdd: (hostname: string) => Promise<string | null>;
}

/** "Add hostname". `onAdd` resolves with an error sentence, or null when it worked. */
export function AddHostnameForm({ disabled, onAdd }: AddHostnameFormProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!value.trim()) {
      setError("Enter a hostname like portal.example.com.");
      return;
    }
    setPending(true);
    const problem = await onAdd(value.trim());
    setPending(false);
    setError(problem);
    if (!problem) setValue("");
  }

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-2">
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="new-hostname">Add hostname</FieldLabel>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="new-hostname"
            value={value}
            placeholder="portal.example.com"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            className="font-mono sm:max-w-sm"
            aria-invalid={Boolean(error)}
            aria-describedby="new-hostname-help"
            disabled={disabled || pending}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" size="sm" className="sm:self-center" disabled={disabled || pending}>
            <Plus data-icon="inline-start" aria-hidden="true" />
            {pending ? "Adding…" : "Add hostname"}
          </Button>
        </div>
        <FieldDescription id="new-hostname-help">
          Use a subdomain you control, such as portal.example.com. It stays pending until its DNS records are in place.
        </FieldDescription>
        {error && <FieldError>{error}</FieldError>}
      </Field>
    </form>
  );
}
