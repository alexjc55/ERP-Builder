import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SelectOption } from "@/lib/selectOptions";

type MLValue = { ru?: string; en?: string; he?: string };
type Lang = "ru" | "en" | "he";

interface SelectOptionsEditorProps {
  value: SelectOption[];
  onChange: (next: SelectOption[]) => void;
  t: (key: string, fallback: string) => string;
}

const LANGS: { code: Lang; label: string; name: string }[] = [
  { code: "ru", label: "RU", name: "Русский" },
  { code: "en", label: "EN", name: "English" },
  { code: "he", label: "HE", name: "עברית" },
];

// Editor for select-field options. Each option carries a stable `value` (the key
// stored on records, never recomputed from the label) and a multilingual label.
// A SINGLE language switcher at the top drives which locale is edited across all
// rows at once, so each option stays a compact one-line row. Existing options
// keep their value untouched; new rows are sent with an empty value and the
// server derives a stable value from the label on save.
export function SelectOptionsEditor({ value, onChange, t }: SelectOptionsEditorProps) {
  const { data: settings } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() },
  });
  const defaultLang = (settings?.defaultLanguage as Lang) ?? "ru";

  const orderedLangs = useMemo(
    () => [...LANGS].sort((a, b) => Number(b.code === defaultLang) - Number(a.code === defaultLang)),
    [defaultLang],
  );

  const [active, setActive] = useState<Lang>(defaultLang);
  useEffect(() => {
    setActive(defaultLang);
  }, [defaultLang]);

  const activeName = LANGS.find((l) => l.code === active)?.name ?? "";

  const updateLabel = (index: number, text: string) => {
    const next = value.slice();
    const prev = (next[index]!.labelJson ?? {}) as MLValue;
    next[index] = { ...next[index]!, labelJson: { ...prev, [active]: text } };
    onChange(next);
  };
  const remove = (index: number) => onChange(value.filter((_, i) => i !== index));
  const add = () => onChange([...value, { value: "", labelJson: {} }]);
  // Reordering only shuffles the options array; the stored `value` of each option
  // stays put, so existing record values keep matching after a reorder.
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= value.length) return;
    const next = value.slice();
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label>{t("fields.options", "Варианты списка")}</Label>
        <Tabs value={active} onValueChange={(v) => setActive(v as Lang)}>
          <TabsList className="h-8 bg-slate-100 p-0.5">
            {orderedLangs.map((lang) => (
              <TabsTrigger
                key={lang.code}
                value={lang.code}
                className="text-xs px-3 h-7 data-[state=active]:bg-white data-[state=active]:shadow-sm"
              >
                {lang.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <p className="text-xs text-slate-400">
        {t(
          "fields.optionsMlHint",
          "Каждый вариант можно задать на нескольких языках. Значение в записях не меняется при переименовании.",
        )}
      </p>
      <div className="space-y-2">
        {value.map((opt, i) => {
          const lj = (opt.labelJson ?? {}) as MLValue;
          return (
            <div key={i} className="flex items-center gap-2">
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400"
                  aria-label={t("common.moveUp", "Выше")}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === value.length - 1}
                  className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400"
                  aria-label={t("common.moveDown", "Ниже")}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <span className="w-6 shrink-0 text-right text-xs text-slate-400">{i + 1}.</span>
              <Input
                value={lj[active] || ""}
                onChange={(e) => updateLabel(i, e.target.value)}
                placeholder={`${t("fields.optionLabel", "Вариант")} ${i + 1} (${activeName})`}
                dir={active === "he" ? "rtl" : "ltr"}
                className="text-sm flex-1 min-w-0"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-slate-400 hover:text-red-600"
                onClick={() => remove(i)}
                aria-label={t("common.delete", "Удалить")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        {value.length === 0 && (
          <p className="text-xs text-slate-400">{t("fields.noOptionsYet", "Вариантов пока нет.")}</p>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={add} className="mt-1">
        <Plus className="h-4 w-4 mr-1" />
        {t("fields.addOption", "Добавить вариант")}
      </Button>
    </div>
  );
}
