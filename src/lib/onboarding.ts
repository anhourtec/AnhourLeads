/** Onboarding vocabularies shared by the flow (client), the API and the home layouts. */

export const ONBOARDING_ROLES = ["founder", "sales_leader", "sdr_ae", "marketing", "recruiting", "other"] as const;
export type OnboardingRole = (typeof ONBOARDING_ROLES)[number];

export const ONBOARDING_ROLE_LABELS: Record<OnboardingRole, string> = {
  founder: "Founder or owner",
  sales_leader: "Sales leader",
  sdr_ae: "SDR or account executive",
  marketing: "Marketing",
  recruiting: "Recruiting",
  other: "Something else",
};

export const TEAM_SIZES = ["just_me", "2_10", "11_50", "51_200", "201_plus"] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];

export const TEAM_SIZE_LABELS: Record<TeamSize, string> = {
  just_me: "Just me",
  "2_10": "2–10",
  "11_50": "11–50",
  "51_200": "51–200",
  "201_plus": "201+",
};

export const ONBOARDING_GOALS = ["outbound", "inbound", "enrichment", "deal_execution"] as const;
export type OnboardingGoal = (typeof ONBOARDING_GOALS)[number];

export const HOME_LAYOUTS = ["getting_started", "generate_pipeline", "win_and_close"] as const;
export type HomeLayout = (typeof HOME_LAYOUTS)[number];

export const HOME_LAYOUT_LABELS: Record<HomeLayout, string> = {
  getting_started: "Getting started",
  generate_pipeline: "Generate pipeline",
  win_and_close: "Win & close",
};
