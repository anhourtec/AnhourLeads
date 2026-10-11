"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Save } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function ProfileForm({ name, email }: { readonly name: string; readonly email: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();

  async function save() {
    setPending(true);
    setError(null);
    const { error: updateError } = await authClient.updateUser({ name: trimmed });
    setPending(false);
    if (updateError) {
      setError("Your name couldn't be saved. Try again.");
      return;
    }
    toast.success("Name saved");
    router.refresh();
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>How you appear to people in your workspace.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="account-name">Name</FieldLabel>
              <Input
                id="account-name"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                required
                maxLength={100}
                autoComplete="name"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="account-email">Email</FieldLabel>
              <Input id="account-email" value={email} readOnly disabled className="font-mono" />
              <FieldDescription>
                Your email is your sign-in. Ask an administrator if it needs to change.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button type="submit" size="sm" disabled={pending || !trimmed || trimmed === name}>
            <Save data-icon="inline-start" />
            {pending ? "Saving…" : "Save name"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
