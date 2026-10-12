import Link from "next/link";

import type { Metadata } from "next";

import { getTenantBrand } from "@/server/auth/context";
import { env } from "@/server/env";

import { SignInForm } from "../../_components/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const { tenant, brand } = await getTenantBrand();
  const canSignUp = tenant.kind === "primary" && env().APP_ALLOW_SIGNUP;
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-medium text-2xl">Sign in to {brand.name}</h1>
        <p className="text-muted-foreground text-sm">Use the email and password for your workspace account.</p>
      </div>
      <SignInForm />
      {canSignUp && (
        <p className="text-center text-muted-foreground text-sm">
          New here?{" "}
          <Link href="/auth/register" className="text-foreground underline underline-offset-4">
            Create a workspace
          </Link>
        </p>
      )}
    </div>
  );
}
