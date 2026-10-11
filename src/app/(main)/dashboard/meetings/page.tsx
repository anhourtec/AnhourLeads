import { CalendarCheck, CalendarPlus, FileText, Handshake, Link2, ListChecks } from "lucide-react";
import type { Metadata } from "next";

import { getAppContext } from "@/server/auth/context";

import { type FeatureBenefit, FeatureUnavailable, type FeatureWorkaround } from "../_components/feature-unavailable";

export const metadata: Metadata = { title: "Meetings" };

const BENEFITS: FeatureBenefit[] = [
  {
    icon: CalendarPlus,
    label: "Booking links",
    description: "Share a link that lets prospects pick a time that suits you.",
  },
  { icon: CalendarCheck, label: "Calendar sync", description: "See booked meetings next to your sequences and tasks." },
  {
    icon: FileText,
    label: "Meeting prep",
    description: "Get the person's and company's details in one place before you join.",
  },
  { icon: Link2, label: "Linked to records", description: "Every meeting shows up on the person, company and deal." },
];

const WORKAROUNDS: FeatureWorkaround[] = [
  {
    label: "Track meetings as deals",
    description: "Create a deal at the meeting stage when a meeting is booked.",
    href: "/dashboard/deals",
    icon: Handshake,
    permission: "deal:read",
  },
  {
    label: "Plan follow-ups",
    description: "Create a task for each follow-up after a meeting.",
    href: "/dashboard/tasks",
    icon: ListChecks,
    permission: "task:read",
  },
];

export default async function MeetingsPage() {
  const { workspace } = await getAppContext();
  return (
    <FeatureUnavailable
      title="Meetings"
      value="Book meetings with prospects and arrive prepared."
      benefits={BENEFITS}
      needs="Meetings need a calendar connection (Google or Microsoft calendar access) set up for this installation. No meetings are read or booked until then."
      workarounds={WORKAROUNDS}
      role={workspace?.role ?? null}
    />
  );
}
