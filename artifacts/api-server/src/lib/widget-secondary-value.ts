/** Validate the reference against the complete replacement config, not old metrics. */
export function validateSecondaryValue(config: {
  widgetType?: string | null;
  metrics?: readonly { key: string }[];
  secondaryValue?: { metricKey: string };
} | undefined): string | null {
  if (!config?.secondaryValue) return null;
  if ((config.widgetType ?? "metric") !== "metric") {
    return "Secondary value is only available for metric widgets";
  }
  if (!(config.metrics ?? []).some(metric => metric.key === config.secondaryValue!.metricKey)) {
    return `Secondary value references an unknown metric: ${config.secondaryValue.metricKey}`;
  }
  return null;
}