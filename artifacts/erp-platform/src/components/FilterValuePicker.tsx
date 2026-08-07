import { useEffect, useState, type ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
/**
 * Sentinel value returned by the filter-values endpoints meaning "no stored
 * value" (NULL/''). Rendered as a localized "(Пусто)" label here; translated
 * into the empty predicate server-side. Keep the literal in sync with
 * EMPTY_FILTER_VALUE in api-server record-query.ts.
 */
export const EMPTY_FILTER_VALUE = "__empty__";

export function ValueChecklistPicker({
  fieldKey,
  selected,
  onChange,
  getOptions,
  labelFor,
  serverSearch = false,
  multiple = true,
  allowManual = false,
  trigger,
  t,
}: {
  fieldKey: string;
  selected: string[];
  onChange: (values: string[]) => void;
  /**
   * Fetch the option values. The optional second arg is the picker's search
   * text: implementations that support it pass it to the server so the search
   * narrows BEFORE the server's row limit (a value outside the first 500
   * distinct values is otherwise unfindable). Implementations that ignore it
   * still work — the client-side label filter below applies regardless.
   */
  getOptions: (fieldKey: string, search?: string) => Promise<string[]>;
  labelFor?: (v: string) => string;
  /**
   * Pass the search box text to `getOptions` so the SERVER narrows the list
   * before its row limit. Must be OFF for fields whose displayed label differs
   * from the stored value (user ids → names, select values → labels, booleans)
   * — the server matches raw stored values, so a label search would find
   * nothing. Those fields keep the client-side label filter only.
   */
  serverSearch?: boolean;
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
  const baseLabel = labelFor ?? ((v: string) => v);
  const label = (v: string): string =>
    v === EMPTY_FILTER_VALUE ? t("records.filterEmptyValue", "(Пусто)") : baseLabel(v);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  // Only used when serverSearch is on; otherwise the constant "" keeps the
  // fetch effect from re-firing while typing.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    if (!serverSearch) return;
    const h = setTimeout(() => setDebouncedSearch(optSearch.trim()), 300);
    return () => clearTimeout(h);
  }, [optSearch, serverSearch]);
  const effectiveSearch = serverSearch ? debouncedSearch : "";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    getOptions(fieldKey, effectiveSearch || undefined)
      .then((vals) => { if (!cancelled) setOptions(vals); })
      .catch(() => { if (!cancelled) setOptions([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, getOptions, fieldKey, effectiveSearch]);

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
        {/* Plain overflow div, NOT Radix ScrollArea: its viewport is h-full,
            which doesn't resolve against a max-height-only parent, so the list
            was clipped at ~8 rows with no scrollbar. */}
        <div className="max-h-64 overflow-y-auto">
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
        </div>
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
