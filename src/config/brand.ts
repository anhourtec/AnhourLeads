/**
 * Installation brand and the white-label palette. See BRANDING.md.
 *
 * Workspaces may change their display name, brand colour and support email. They never change
 * fonts, layout or spacing. Brand colours are named Tailwind palette hues only (no hex), mapped to
 * the `--primary` token in src/styles/brand.css for both light and dark mode.
 */

export const BRAND_COLORS = [
  "indigo",
  "violet",
  "blue",
  "sky",
  "teal",
  "emerald",
  "green",
  "amber",
  "orange",
  "rose",
  "red",
  "slate",
] as const;

export type BrandColor = (typeof BRAND_COLORS)[number];

export interface Brand {
  /** Name shown in the sidebar, sign-in pages, page titles and emails. */
  name: string;
  color: BrandColor;
  supportEmail: string | null;
  /** True when a workspace brand is shown (white-label host or the signed-in workspace). */
  isWorkspaceBrand: boolean;
}

export const DEFAULT_BRAND: Brand = {
  name: "AnhourLeads",
  color: "indigo",
  supportEmail: null,
  isWorkspaceBrand: false,
};

export function isBrandColor(value: unknown): value is BrandColor {
  return typeof value === "string" && (BRAND_COLORS as readonly string[]).includes(value);
}
