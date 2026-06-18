import { useEffect, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Plus } from "lucide-react";

/**
 * Shared searchable "existing values" checklist popover. This is the single source
 * of the value-selection UI used by BOTH the live records filter bar
 * (FieldFilterPopover) and the view/default filter editor (FilterValueEditor), so
 * the two never diverge. Values are fetched lazily on open via `getOptions`
 * (the records filter-values endpoint), filtered by a search box, and rendered as
 * a checkbox list. Labels are resolved through the optional `labelFor` (e.g. user
 * ids → names, booleans → Да/Нет); selected values not present in the fetched set
 * are still shown so a committed value never disappears.
 */
export function ValueChecklistPicker({
  fieldKey,
  selected,
  onChange,
  getOptions,
  labelFor,
  multiple = true,
  allowManual = false,
  trigger,
  t,
}: {
  fieldKey: string;
  selected: string[];
  onChange: (values: string[]) => void;
  getOptions: (fieldKey: string) => Promise<string[]>;
  labelFor?: (v: string) => string;
  multiple?: boolean;
  /** Allow typing a value not present in the fetched list (filter authoring). */
  allowManual?: boolean;
  trigger: ReactNode;
  t: (key: string, def: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [optSearch, setOptSearch] = useState("");
  const [manual, setManual] = useState("");
  const label = labelFor ?? ((v: string) => v);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getOptions(fieldKey)
      .then((vals) => { if (!cancelled) setOptions(vals); })
      .catch(() => { if (!cancelled) setOptions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, getOptions, fieldKey]);

  const toggle = (v: string) => {
    if (multiple) {
      onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
    } else {
      onChange([v]);
      setOpen(false);
    }
  };

  const addManual = () => {
    const v = manual.trim();
    if (!v) return;
    if (multiple) {
      if (!selected.includes(v)) onChange([...selected, v]);
    } else {
      onChange([v]);
      setOpen(false);
    }
    setManual("");
  };

  // Keep already-selected values visible even if they aren't in the fetched list.
  const allValues = [...options, ...selected.filter((s) => !options.includes(s))];
  const q = optSearch.toLowerCase();
  const filtered = allValues.filter((v) => label(v).toLowerCase().includes(q));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="p-2 border-b border-slate-100">
          <Input
            value={optSearch}
            onChange={(e) => setOptSearch(e.target.value)}
            placeholder={t("records.filterSearchValues", "Поиск значений…")}
            className="h-8 text-sm"
          />
        </div>
        <ScrollArea className="max-h-64">
          <div className="p-1">
            {loading ? (
              <div className="flex items-center justify-center py-6 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-slate-400">
                {t("records.filterNoValues", "Нет значений")}
              </p>
            ) : (
              filtered.map((v) => (
                <label
                  key={v}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer text-sm"
                >
                  <Checkbox checked={selected.includes(v)} onCheckedChange={() => toggle(v)} />
                  <span className="truncate">{label(v)}</span>
                </label>
              ))
            )}
          </div>
        </ScrollArea>
        {allowManual && (
          <div className="flex items-center gap-1.5 border-t border-slate-100 p-2">
            <Input
              className="h-7 text-xs"
              value={manual}
              placeholder={t("views.manualValue", "вручную…")}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addManual();
                }
              }}
            />
            <Button type="button" size="sm" variant="outline" className="h-7 px-2" onClick={addManual} disabled={!manual.trim()}>
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}
        {multiple && selected.length > 0 && (
          <div className="p-1.5 border-t border-slate-100">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs text-slate-500"
              onClick={() => onChange([])}
            >
              {t("records.filterClearField", "Очистить")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
