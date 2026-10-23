import { useLang, useT } from "@/lib/i18n";
import { activityLabels, activityStatusName, localizedActivityLabel } from "./activityLabels";

export function LatestActivityValue({ value }: { value: unknown }) {
  const { lang } = useLang();
  const t = useT();
  if (!value || typeof value !== "object") return <span className="text-slate-300">—</span>;
  const entry = value as { kind?: string; occurredAt?: string; statusNameJson?: unknown };
  const date = new Date(entry.occurredAt ?? "");
  if (!entry.kind || !activityLabels[entry.kind] || !Number.isFinite(date.getTime())) return <span>—</span>;
  return <span className="inline-flex flex-col text-start leading-snug">
    <span>{t(`activity.kind.${entry.kind}`, localizedActivityLabel(entry.kind, lang))}
      {entry.kind === "status_changed" && activityStatusName(entry.statusNameJson, lang) && <> → {activityStatusName(entry.statusNameJson, lang)}</>}
    </span>
    <time dateTime={date.toISOString()} className="text-xs opacity-70" dir="ltr">
      {new Intl.DateTimeFormat(lang === "he" ? "he-IL" : lang === "ru" ? "ru-RU" : "en-GB",
        { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date)}
    </time>
  </span>;
}
