import { FileText, Mic, NotebookPen, Sparkles, Tags } from "lucide-react";
import type { Metadata } from "next";

import { getAppContext } from "@/server/auth/context";

import { type FeatureBenefit, FeatureUnavailable, type FeatureWorkaround } from "../_components/feature-unavailable";

export const metadata: Metadata = { title: "Conversations" };

const BENEFITS: FeatureBenefit[] = [
  { icon: Mic, label: "Recording", description: "Capture calls and meetings with the person's consent." },
  {
    icon: FileText,
    label: "Transcripts",
    description: "Read and search what was said, not just that a call happened.",
  },
  { icon: Sparkles, label: "Summaries", description: "Get the key points and next steps from each conversation." },
  { icon: Tags, label: "Trackers", description: "Spot topics such as pricing or competitors across conversations." },
];

const WORKAROUNDS: FeatureWorkaround[] = [
  {
    label: "Keep notes on people",
    description: "Add notes and see the activity timeline on a person's page.",
    href: "/dashboard/people",
    icon: NotebookPen,
    permission: "contact:read",
  },
];

export default async function ConversationsPage() {
  const { workspace } = await getAppContext();
  return (
    <FeatureUnavailable
      title="Conversations"
      value="Record calls and meetings and turn them into searchable notes."
      benefits={BENEFITS}
      needs="Conversations need a call and meeting recording provider connected to this installation. Nothing is recorded or transcribed until then."
      workarounds={WORKAROUNDS}
      role={workspace?.role ?? null}
    />
  );
}
