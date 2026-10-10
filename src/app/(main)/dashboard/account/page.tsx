import type { Metadata } from "next";

import { ROLE_LABELS } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";

import { PageHeader } from "../_components/pipeline/page-header";
import { PasswordForm } from "./_components/password-form";
import { ProfileForm } from "./_components/profile-form";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const { user, workspace } = await getAppContext();
  return (
    <div className="flex max-w-3xl flex-col gap-4 md:gap-6">
      <PageHeader
        title="Account"
        description={
          workspace
            ? `Your sign-in details. You're ${ROLE_LABELS[workspace.role].toLowerCase()} in ${workspace.name}.`
            : "Your sign-in details."
        }
      />
      <ProfileForm name={user.name} email={user.email} />
      <PasswordForm />
    </div>
  );
}
