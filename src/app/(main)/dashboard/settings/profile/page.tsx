import type { Metadata } from "next";

import { ROLE_LABELS } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";

import { PageHeader } from "../../_components/pipeline/page-header";
import { PasswordForm } from "./_components/password-form";
import { ProfileForm } from "./_components/profile-form";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const { user, workspace } = await getAppContext();
  return (
    <div className="flex max-w-3xl flex-col gap-4 md:gap-6">
      <PageHeader
        title="Profile"
        description={
          workspace
            ? `Your name and sign-in details. You're ${ROLE_LABELS[workspace.role].toLowerCase()} in ${workspace.name}.`
            : "Your name and sign-in details."
        }
      />
      <ProfileForm name={user.name} email={user.email} />
      <PasswordForm />
    </div>
  );
}
