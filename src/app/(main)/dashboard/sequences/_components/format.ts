/** Display helpers for the sequences screens (fixed locale so server and client render the same). */
export const count = (value: number) => value.toLocaleString("en-US");

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value * 1000) / 10}%`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
