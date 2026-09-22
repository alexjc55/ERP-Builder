import { formatFormulaValue } from "@workspace/formula";

export type WebhookLanguage = "ru" | "en" | "he";
export function webhookLabel(value: unknown, language: WebhookLanguage): string {
  const labels = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return String(labels[language] || labels.ru || labels.en || labels.he || "");
}

/** Only links and display metadata cross this boundary, never storage credentials. */
export function webhookFile(value: unknown, baseUrl?: string): unknown {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map((item) => webhookFile(item, baseUrl));
  if (typeof value !== "object") throw new Error("Invalid webhook file value");
  const file = value as Record<string, unknown>;
  const kind = file.kind === "gdrive" || file.kind === "link" ? file.kind : "server";
  let url = kind === "gdrive"
    ? String(file.webViewLink || (file.fileId ? `https://drive.google.com/file/d/${encodeURIComponent(String(file.fileId))}/view` : ""))
    : String(kind === "link" ? file.url ?? "" : file.path ?? "");
  if (!url) throw new Error("Webhook file has no usable URL");
  // Matches the client objectServingUrl() route, not a public disk path.
  if (kind === "server" && /^\/?(local|objects)\//.test(url)) url = `/api/storage/${url.replace(/^\//, "")}`;
  if (!/^https?:\/\//i.test(url)) {
    if (kind !== "server" || !baseUrl) throw new Error("Relative webhook file URL requires webhook baseUrl or WEBHOOK_ORIGIN");
    const base = new URL(baseUrl);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Invalid webhook baseUrl");
    const absolute = new URL(url, base.origin);
    if (absolute.origin !== base.origin) throw new Error("Local webhook file URL must use the configured application origin");
    url = absolute.href;
  }
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error("Unsafe webhook file URL");
  return {
    kind, name: typeof file.name === "string" ? file.name : url, url,
    ...(kind === "gdrive" ? { fileId: String(file.fileId ?? "") } : {}),
    ...(kind === "server" ? { requiresAuthentication: true } : {}),
  };
}

export function webhookDisplay(value: unknown, field: {
  fieldType: string;
  formulaConfigJson?: { decimals?: number | null; displayAffix?: string | null; displayAffixPosition?: string | null };
  percentConfigJson?: { decimals?: number | null };
}, language: WebhookLanguage, timeZone = "UTC"): string {
  if (value == null || value === "") return "—";
  if (Array.isArray(value)) return value.map((v) => webhookDisplay(v, field, language, timeZone)).filter(Boolean).join(", ") || "—";
  if (typeof value === "boolean") return language === "ru" ? (value ? "Да" : "Нет") : language === "he" ? (value ? "כן" : "לא") : (value ? "Yes" : "No");
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return String(item.displayValue ?? item.label ?? item.name ?? item.url ?? (item.id != null ? `#${item.id}` : "—"));
  }
  if (["date", "datetime", "created_at"].includes(field.fieldType)) {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime())) {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: field.fieldType === "date" ? "UTC" : timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
      const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
      const day = `${part("day")}.${part("month")}.${part("year")}`;
      return field.fieldType === "date" ? day : `${day} ${part("hour")}:${part("minute")}`;
    }
  }
  if (typeof value === "number" && field.fieldType === "percent") return `${formatFormulaValue(value, field.percentConfigJson?.decimals).text}%`;
  if (field.fieldType === "function" || field.fieldType === "number") {
    const cfg = field.formulaConfigJson;
    const text = typeof value === "number" ? formatFormulaValue(value, cfg?.decimals).text : String(value);
    const affix = cfg?.displayAffix?.trim();
    return typeof value === "number" && affix ? (cfg?.displayAffixPosition === "before" ? `${affix} ${text}` : `${text} ${affix}`) : text;
  }
  return String(value);
}