import type { Metadata } from "next";

import { ResetPasswordForm } from "../../_components/password-forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/auth/reset-password">) {
  const { token } = await searchParams;
  return (
    <div className="space-y-6">
      <h1 className="font-medium text-2xl">Choose a new password</h1>
      <ResetPasswordForm token={typeof token === "string" ? token : null} />
    </div>
  );
}
