import { Bell, Building2, Eye, Globe, Radar, UserPlus } from "lucide-react";
import type { Metadata } from "next";

import { getAppContext } from "@/server/auth/context";

import { type FeatureBenefit, FeatureUnavailable, type FeatureWorkaround } from "../_components/feature-unavailable";

export const metadata: Metadata = { title: "Website visitors" };

const BENEFITS: FeatureBenefit[] = [
  { icon: Globe, label: "Identify companies", description: "Match visits to the companies behind them." },
  { icon: Eye, label: "Pages viewed", description: "See which pages each company looked at and when." },
  { icon: Bell, label: "Alerts", description: "Get notified when a target company comes back." },
  {
    icon: UserPlus,
    label: "Find the right people",
    description: "Jump from a visiting company to people worth contacting.",
  },
];

const WORKAROUNDS: FeatureWorkaround[] = [
  {
    label: "Research a company's website",
    description: "Crawl a company's public pages for people and details.",
    href: "/dashboard/research",
    icon: Radar,
    permission: "crawler:read",
  },
  {
    label: "Browse companies",
    description: "Find and qualify the companies you already have.",
    href: "/dashboard/companies",
    icon: Building2,
    permission: "company:read",
  },
];

export default async function WebsiteVisitorsPage() {
  const { workspace } = await getAppContext();
  return (
    <FeatureUnavailable
      title="Website visitors"
      value="See which companies are browsing your website and reach out while they're interested."
      benefits={BENEFITS}
      needs="Website visitors need a tracking script on your website plus an IP-to-company data source. Neither is set up in this installation, so no visits are collected."
      workarounds={WORKAROUNDS}
      role={workspace?.role ?? null}
    />
  );
}
