import { FormInput, Route, ShieldCheck, Sparkles, Upload } from "lucide-react";
import type { Metadata } from "next";

import { getAppContext } from "@/server/auth/context";

import { type FeatureBenefit, FeatureUnavailable, type FeatureWorkaround } from "../_components/feature-unavailable";

export const metadata: Metadata = { title: "Forms" };

const BENEFITS: FeatureBenefit[] = [
  { icon: FormInput, label: "Form builder", description: "Build a form with your brand and the fields you need." },
  { icon: Sparkles, label: "Enrich on submit", description: "Fill in company and job details from just an email." },
  { icon: Route, label: "Route new leads", description: "Send each submission to the right owner or sequence." },
  { icon: ShieldCheck, label: "Consent", description: "Record consent with every submission." },
];

const WORKAROUNDS: FeatureWorkaround[] = [
  {
    label: "Import people from CSV",
    description: "Bring in leads you've collected elsewhere.",
    href: "/dashboard/people",
    icon: Upload,
    permission: "contact:import",
  },
  {
    label: "Enrich your data",
    description: "Fill in missing details on people and companies.",
    href: "/dashboard/enrichment",
    icon: Sparkles,
    permission: "enrich:run",
  },
];

export default async function FormsPage() {
  const { workspace } = await getAppContext();
  return (
    <FeatureUnavailable
      title="Forms"
      value="Capture leads from your website and enrich them as they arrive."
      benefits={BENEFITS}
      needs="Forms need a form builder and a public form endpoint, which this installation doesn't have yet. No submissions are collected."
      workarounds={WORKAROUNDS}
      role={workspace?.role ?? null}
    />
  );
}
