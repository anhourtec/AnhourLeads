import type { BrandColor } from "@/config/brand";

/** Swatch fill per brand colour (600 light, 500 dark, as in src/styles/brand.css). Literal classes for Tailwind. */
export const SWATCH: Record<BrandColor, string> = {
  indigo: "bg-indigo-600 dark:bg-indigo-500",
  violet: "bg-violet-600 dark:bg-violet-500",
  blue: "bg-blue-600 dark:bg-blue-500",
  sky: "bg-sky-600 dark:bg-sky-500",
  teal: "bg-teal-600 dark:bg-teal-500",
  emerald: "bg-emerald-600 dark:bg-emerald-500",
  green: "bg-green-600 dark:bg-green-500",
  amber: "bg-amber-500",
  orange: "bg-orange-600 dark:bg-orange-500",
  rose: "bg-rose-600 dark:bg-rose-500",
  red: "bg-red-600 dark:bg-red-500",
  slate: "bg-slate-600 dark:bg-slate-500",
};

export const colorLabel = (c: BrandColor) => `${c[0].toUpperCase()}${c.slice(1)}`;
