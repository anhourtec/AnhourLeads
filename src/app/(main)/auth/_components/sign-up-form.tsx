"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { UserPlus } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const formSchema = z.object({
  name: z.string().trim().min(2, { message: "Enter your name." }),
  workspaceName: z.string().trim().min(2, { message: "Name your workspace (your company or team)." }),
  email: z.email({ message: "Enter a valid email address." }),
  password: z.string().min(10, { message: "Use at least 10 characters." }),
});

type Values = z.infer<typeof formSchema>;

const FIELDS: { name: keyof Values; label: string; type: string; autoComplete: string }[] = [
  { name: "name", label: "Your name", type: "text", autoComplete: "name" },
  { name: "workspaceName", label: "Workspace name", type: "text", autoComplete: "organization" },
  { name: "email", label: "Work email", type: "email", autoComplete: "email" },
  { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
];

export function SignUpForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", workspaceName: "", email: "", password: "" },
  });

  async function onSubmit(values: Values) {
    setError(null);
    const { error: signUpError } = await authClient.signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
    });
    if (signUpError) {
      setError(signUpError.message ?? "Couldn't create your account.");
      return;
    }
    const res = await fetch("/api/v1/workspaces/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceName: values.workspaceName }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Your account was created, but the workspace wasn't. Sign in and try again.");
      return;
    }
    router.replace("/onboarding");
    router.refresh();
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FieldGroup className="gap-4">
        {FIELDS.map((f) => (
          <Controller
            key={f.name}
            control={form.control}
            name={f.name}
            render={({ field, fieldState }) => (
              <Field className="gap-1.5" data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`sign-up-${f.name}`}>{f.label}</FieldLabel>
                <Input
                  {...field}
                  id={`sign-up-${f.name}`}
                  type={f.type}
                  autoComplete={f.autoComplete}
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
        ))}
      </FieldGroup>
      <Button size="lg" className="w-full" type="submit" disabled={form.formState.isSubmitting}>
        <UserPlus data-icon="inline-start" />
        {form.formState.isSubmitting ? "Creating workspace…" : "Create workspace"}
      </Button>
    </form>
  );
}
