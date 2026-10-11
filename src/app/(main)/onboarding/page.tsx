import { redirect } from "next/navigation";

import type { Metadata } from "next";

import { can } from "@/lib/rbac/permissions";
import { getAppContext } from "@/server/auth/context";
import { needsOnboarding, onboardingFor } from "@/server/services/onboarding";

import { OnboardingFlow } from "./_components/onboarding-flow";

export const metadata: Metadata = { title: "Get started" };

export default async function OnboardingPage() {
  const context = await getAppContext();
  const workspace = context.workspace;
  if (!workspace || !(await needsOnboarding(workspace.organizationId, context.user.id, workspace.role))) {
    redirect("/dashboard/home");
  }
  const state = await onboardingFor(workspace.organizationId, context.user.id);
  return (
    <OnboardingFlow
      firstName={context.user.name.split(" ")[0] || context.user.name}
      initial={{ role: state.role, teamSize: state.teamSize, goals: state.goals }}
      canConnectMailbox={can(workspace.role, "mailbox:create")}
    />
  );
}
