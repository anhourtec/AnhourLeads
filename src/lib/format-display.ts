/** Display helpers shared by the pipeline and settings screens. Locale is fixed so server and client match. */

const LOCALE = "en-US";

export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE).format(value);
}

const COMPACT_STEPS: [number, string][] = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/**
 * Money in whole units. `compact` gives "$48K" / "$1.2M". Compact notation is built by hand because
 * Node's and browsers' ICU data round it differently, which would break hydration.
 */
export function formatMoney(amount: number | null | undefined, currency = "USD", compact = false): string {
  if (amount === null || amount === undefined) return "—";
  let format: Intl.NumberFormat;
  try {
    format = new Intl.NumberFormat(LOCALE, { style: "currency", currency, maximumFractionDigits: 0 });
  } catch {
    return `${formatNumber(amount)} ${currency}`;
  }
  const step = compact ? COMPACT_STEPS.find(([size]) => Math.abs(amount) >= size) : undefined;
  if (!step) return format.format(amount);
  const scaled = `${Math.round((Math.abs(amount) / step[0]) * 10) / 10}${step[1]}`;
  const parts = format.formatToParts(amount < 0 ? -1 : 1);
  return parts
    .filter((part) => part.type !== "fraction" && part.type !== "decimal")
    .map((part) => (part.type === "integer" ? scaled : part.value))
    .join("");
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 0 }).format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(LOCALE, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(value),
  );
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}

/** "3 days ago", "in 2 hours". `now` is passed in so server and client render the same text. */
export function relativeTime(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return "—";
  const diff = new Date(value).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 864e5],
    ["month", 30 * 864e5],
    ["week", 7 * 864e5],
    ["day", 864e5],
    ["hour", 36e5],
    ["minute", 6e4],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

/** Value for an <input type="date"> from an ISO string. */
export function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}
