"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { KeyRound, Mail } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    await authClient.requestPasswordReset({ email, redirectTo: "/auth/reset-password" });
    // Same answer whether or not the account exists.
    setSent(true);
    setPending(false);
  }

  if (sent) {
    return (
      <Alert>
        <AlertDescription>If an account exists for that email, a reset link is on its way.</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FieldGroup>
        <Field className="gap-1.5">
          <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
          <Input id="forgot-email" name="email" type="email" autoComplete="email" required />
        </Field>
      </FieldGroup>
      <Button size="lg" type="submit" disabled={pending}>
        <Mail data-icon="inline-start" />
        Send reset link
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { readonly token: string | null }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          This reset link is invalid or has expired. <Link href="/auth/forgot-password">Request a new one</Link>.
        </AlertDescription>
      </Alert>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newPassword = String(new FormData(event.currentTarget).get("password") ?? "");
    if (newPassword.length < 10) {
      setError("Use at least 10 characters.");
      return;
    }
    setPending(true);
    const { error: resetError } = await authClient.resetPassword({ newPassword, token: token ?? "" });
    setPending(false);
    if (resetError) {
      setError("This reset link is invalid or has expired.");
      return;
    }
    router.replace("/auth/login");
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <Field className="gap-1.5">
          <FieldLabel htmlFor="reset-password">New password</FieldLabel>
          <Input
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
          />
        </Field>
      </FieldGroup>
      <Button size="lg" type="submit" disabled={pending}>
        <KeyRound data-icon="inline-start" />
        Set new password
      </Button>
    </form>
  );
}
