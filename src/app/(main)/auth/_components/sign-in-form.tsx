"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { LogIn } from "lucide-react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

const formSchema = z.object({
  email: z.email({ message: "Enter a valid email address." }),
  password: z.string().min(1, { message: "Enter your password." }),
  remember: z.boolean(),
});

export function SignInForm() {
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "", remember: true },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setError(null);
    const { error: signInError } = await authClient.signIn.email({
      email: values.email,
      password: values.password,
      rememberMe: values.remember,
    });
    if (signInError) {
      setError(
        signInError.status === 429 ? "Too many attempts. Wait a minute and try again." : "Invalid email or password.",
      );
      return;
    }
    // Only same-site relative paths are followed.
    router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard/home");
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
        <Controller
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field className="gap-1.5" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="sign-in-email">Email</FieldLabel>
              <Input
                {...field}
                id="sign-in-email"
                type="email"
                autoComplete="email"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <Field className="gap-1.5" data-invalid={fieldState.invalid}>
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="sign-in-password">Password</FieldLabel>
                <Link
                  href="/auth/forgot-password"
                  className="text-muted-foreground text-xs underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                {...field}
                id="sign-in-password"
                type="password"
                autoComplete="current-password"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="remember"
          render={({ field }) => (
            <Field orientation="horizontal">
              <Checkbox
                id="sign-in-remember"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(Boolean(checked))}
              />
              <FieldContent>
                <FieldLabel htmlFor="sign-in-remember" className="font-normal">
                  Keep me signed in
                </FieldLabel>
              </FieldContent>
            </Field>
          )}
        />
      </FieldGroup>
      <Button size="lg" className="w-full" type="submit" disabled={form.formState.isSubmitting}>
        <LogIn data-icon="inline-start" />
        {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
