import { ChevronUp, ChevronDown } from "lucide-react";
import type { FileSource } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/** Canonical list of file sources offered when enabling them on a `file` field. */
export const FILE_SOURCES: { value: FileSource; labelKey: string; label: string }[] = [
  { value: "server", labelKey: "fields.fileSource.server", label: "Загрузка на сервер" },
  { value: "gdrive", labelKey: "fields.fileSource.gdrive", label: "Загрузка в Google Drive" },
  { value: "link", labelKey: "fields.fileSource.link", label: "Ссылка" },
];

/**
 * Enable/disable + ORDER the file sources of a `file` field. The stored
 * `allowedSources` array order is meaningful: it drives the order of the source
 * tabs at fill time and its first element is the default source. Enabling a
 * source appends it to the end; up/down arrows reorder the enabled sources.
 */
export function FileSourcesConfig({
  value,
  onChange,
  t,
  idPrefix,
}: {
  value: FileSource[];
  onChange: (next: FileSource[]) => void;
  t: (key: string, fallback: string) => string;
  idPrefix: string;
}) {
  const labelOf = (s: FileSource): string => {
    const def = FILE_SOURCES.find((x) => x.value === s);
    return def ? t(def.labelKey, def.label) : s;
  };

  const toggle = (s: FileSource, on: boolean) => {
    const next = on ? [...value, s] : value.filter((x) => x !== s);
    onChange(next.length > 0 ? next : value);
  };

  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5 pt-1">
        {FILE_SOURCES.map((s) => (
          <div key={s.value} className="flex items-center gap-2">
            <Switch
              id={`${idPrefix}-${s.value}`}
              checked={value.includes(s.value)}
              onCheckedChange={(on) => toggle(s.value, on)}
            />
            <Label htmlFor={`${idPrefix}-${s.value}`}>{t(s.labelKey, s.label)}</Label>
          </div>
        ))}
      </div>
      {value.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs text-slate-400">
            {t("fields.fileSourceOrderHint", "Порядок источников. Первый используется по умолчанию.")}
          </p>
          <div className="space-y-1">
            {value.map((s, idx) => (
              <div
                key={s}
                className="flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1"
              >
                <span className="text-sm text-slate-700">{labelOf(s)}</span>
                {idx === 0 && (
                  <Badge variant="secondary" className="text-[10px]">
                    {t("fields.fileSourceDefault", "по умолчанию")}
                  </Badge>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={idx === 0}
                    onClick={() => move(idx, -1)}
                    aria-label={t("common.moveUp", "Вверх")}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={idx === value.length - 1}
                    onClick={() => move(idx, 1)}
                    aria-label={t("common.moveDown", "Вниз")}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
