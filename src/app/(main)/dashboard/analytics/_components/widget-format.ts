import type { AnalyticsGroupBy, AnalyticsMetric } from "@/server/services/analytics";
import type { Widget, WidgetData, WidgetType } from "@/server/services/dashboards";

export type { AnalyticsGroupBy, AnalyticsMetric, Widget, WidgetData, WidgetType };

/** The metric catalogue, built on the server (labels, supported groupings) and passed to client components. */
export interface Catalogue {
  metrics: Array<{ key: AnalyticsMetric; label: string; groupBys: AnalyticsGroupBy[]; currency: boolean }>;
  groupByLabels: Record<AnalyticsGroupBy, string>;
  ranges: Array<{ key: Widget["range"]; label: string }>;
}

const integer = new Intl.NumberFormat("en-US");
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatValue(value: number, currency: boolean): string {
  return currency ? money.format(value) : integer.format(value);
}

export function isCurrency(catalogue: Catalogue, metric: AnalyticsMetric): boolean {
  return catalogue.metrics.find((m) => m.key === metric)?.currency ?? false;
}

export const TIME_GROUPS: ReadonlySet<AnalyticsGroupBy> = new Set(["day", "week", "month"]);

export const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  kpi: "KPI",
  bar: "Bar chart",
  line: "Line chart",
  table: "Table",
};
