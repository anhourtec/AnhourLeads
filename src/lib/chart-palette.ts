import type { ChartConfig } from "@/components/ui/chart";

/**
 * Categorical chart colours, assigned in this fixed order and never cycled (BRANDING.md, dataviz).
 * Named Tailwind palette colours, validated for colour-vision deficiency and contrast against the
 * light and dark card surfaces. Four slots: a fifth series folds into "Other" or a table.
 */
export const CATEGORICAL = [
  { light: "var(--color-sky-600)", dark: "var(--color-sky-600)" },
  { light: "var(--color-amber-600)", dark: "var(--color-amber-600)" },
  { light: "var(--color-violet-600)", dark: "var(--color-violet-500)" },
  { light: "var(--color-emerald-600)", dark: "var(--color-emerald-600)" },
] as const;

/** Chart config for series keys, colour by position in `keys` (the entity's fixed slot). */
export function seriesConfig(series: ReadonlyArray<{ key: string; label: string }>): ChartConfig {
  const config: ChartConfig = {};
  series.slice(0, CATEGORICAL.length).forEach((s, i) => {
    const slot = CATEGORICAL[i % CATEGORICAL.length] ?? CATEGORICAL[0];
    config[s.key] = { label: s.label, theme: { light: slot.light, dark: slot.dark } };
  });
  return config;
}
