import Link from "next/link";
import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { getTenantBrand } from "@/server/auth/context";
import { env } from "@/server/env";

import { SignUpForm } from "../../_components/sign-up-form";

export const metadata: Metadata = { title: "Create a workspace" };

export default async function RegisterPage() {
  const { tenant } = await getTenantBrand();
  if (tenant.kind !== "primary" || !env().APP_ALLOW_SIGNUP) notFound();
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-medium text-2xl">Create your workspace</h1>
        <p className="text-muted-foreground text-sm">You'll be its owner. Invite your team once you're in.</p>
      </div>
      <SignUpForm />
      <p className="text-center text-muted-foreground text-sm">
        Already have an account?{" "}
        <Link href="/auth/login" className="text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  );
}
