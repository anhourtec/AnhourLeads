export const TABS = [
  { value: "overview", label: "Overview" },
  { value: "domains", label: "Domains" },
  { value: "mailboxes", label: "Mailboxes" },
  { value: "protection", label: "Sending protection" },
] as const;

export type TabValue = (typeof TABS)[number]["value"];

export function isTab(value: string): value is TabValue {
  return TABS.some((t) => t.value === value);
}

export function percent(value: number | null, digits = 1): string {
  if (value === null) return "–";
  const factor = 10 ** digits;
  return `${Math.round(value * 100 * factor) / factor}%`;
}

export const numberFormat = new Intl.NumberFormat("en-US");
