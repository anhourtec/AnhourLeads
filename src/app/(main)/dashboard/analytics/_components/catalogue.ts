import "server-only";

import {
  ANALYTICS_METRICS,
  CURRENCY_METRICS,
  GROUP_BY_LABELS,
  groupBysFor,
  METRIC_LABELS,
  RANGE_LABELS,
  WIDGET_RANGES,
} from "@/server/services/analytics";

import type { Catalogue } from "./widget-format";

export function buildCatalogue(): Catalogue {
  return {
    metrics: ANALYTICS_METRICS.map((key) => ({
      key,
      label: METRIC_LABELS[key],
      groupBys: groupBysFor(key),
      currency: CURRENCY_METRICS.has(key),
    })),
    groupByLabels: GROUP_BY_LABELS,
    ranges: WIDGET_RANGES.map((key) => ({ key, label: RANGE_LABELS[key] })),
  };
}
