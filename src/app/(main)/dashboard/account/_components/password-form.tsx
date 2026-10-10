"use client";

import { useState } from "react";

import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const MIN_LENGTH = 10;

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = next.length > 0 && next.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;

  async function submit() {
    setPending(true);
    setError(null);
    const { error: changeError } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: revokeOthers,
    });
    setPending(false);
    if (changeError) {
      setError(
        changeError.status === 400 || changeError.status === 401
          ? "Your current password isn't right."
          : "Your password couldn't be changed. Try again.",
      );
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    toast.success(revokeOthers ? "Password changed. Other devices were signed out." : "Password changed");
  }

  return (
    <Card>
      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Use at least {MIN_LENGTH} characters. A long phrase is easier to remember.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <FieldGroup className="gap-4">
            <Field>
              <FieldLabel htmlFor="password-current">Current password</FieldLabel>
              <Input
                id="password-current"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={tooShort}>
                <FieldLabel htmlFor="password-new">New password</FieldLabel>
                <Input
                  id="password-new"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MIN_LENGTH}
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  aria-invalid={tooShort}
                />
                {tooShort ? <FieldError>Use at least {MIN_LENGTH} characters.</FieldError> : null}
              </Field>
              <Field data-invalid={mismatch}>
                <FieldLabel htmlFor="password-confirm">Confirm new password</FieldLabel>
                <Input
                  id="password-confirm"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-invalid={mismatch}
                />
                {mismatch ? <FieldError>The passwords don't match.</FieldError> : null}
              </Field>
            </div>
            <Field orientation="horizontal">
              <Checkbox
                id="password-revoke"
                checked={revokeOthers}
                onCheckedChange={(checked) => setRevokeOthers(checked === true)}
              />
              <FieldLabel htmlFor="password-revoke" className="font-normal">
                Sign out of other devices
              </FieldLabel>
            </Field>
            <FieldDescription className="sr-only">
              Signing out of other devices keeps this one signed in.
            </FieldDescription>
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={pending || !current || next.length < MIN_LENGTH || next !== confirm}
          >
            <KeyRound data-icon="inline-start" />
            {pending ? "Changing…" : "Change password"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
