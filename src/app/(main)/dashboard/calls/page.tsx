import { History, ListChecks, NotebookPen, PhoneCall, Send } from "lucide-react";
import type { Metadata } from "next";

import { getAppContext } from "@/server/auth/context";

import { type FeatureBenefit, FeatureUnavailable, type FeatureWorkaround } from "../_components/feature-unavailable";

export const metadata: Metadata = { title: "Calls" };

const BENEFITS: FeatureBenefit[] = [
  { icon: PhoneCall, label: "Click to call", description: "Dial a person straight from their record or a task list." },
  { icon: ListChecks, label: "Call sessions", description: "Work through a queue of call tasks one after another." },
  {
    icon: NotebookPen,
    label: "Outcomes and notes",
    description: "Log what happened on each call so the next step is clear.",
  },
  {
    icon: History,
    label: "Call history",
    description: "See every call on the person's timeline next to their emails.",
  },
];

const WORKAROUNDS: FeatureWorkaround[] = [
  {
    label: "Log calls as call tasks",
    description: "Create call tasks, then complete them with the outcome.",
    href: "/dashboard/tasks?type=call",
    icon: ListChecks,
    permission: "task:read",
  },
  {
    label: "Add call steps to sequences",
    description: "Sequences can create a call task at the right step.",
    href: "/dashboard/sequences",
    icon: Send,
    permission: "sequence:read",
  },
];

export default async function CallsPage() {
  const { workspace } = await getAppContext();
  return (
    <FeatureUnavailable
      title="Calls"
      value="Call prospects from the app and keep every conversation on their record."
      benefits={BENEFITS}
      needs="Calling from the app needs a telephony provider (a dialer service with phone numbers) connected to this installation. Until then, nothing here places real calls."
      workarounds={WORKAROUNDS}
      role={workspace?.role ?? null}
    />
  );
}
