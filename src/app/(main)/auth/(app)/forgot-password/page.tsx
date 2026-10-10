import Link from "next/link";

import type { Metadata } from "next";

import { ForgotPasswordForm } from "../../_components/password-forms";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-medium text-2xl">Reset your password</h1>
        <p className="text-muted-foreground text-sm">We'll email you a link to choose a new one.</p>
      </div>
      <ForgotPasswordForm />
      <Link
        href="/auth/login"
        className="block text-center text-muted-foreground text-sm underline-offset-4 hover:underline"
      >
        Back to sign in
      </Link>
    </div>
  );
}
