import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ICON_NAMES, getIconComponent } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { Search, ChevronDown, X } from "lucide-react";
import { useT } from "@/lib/i18n";

/**
 * Visual icon picker backed by the shared icon registry. Replaces free-text
 * icon-name entry: the trigger shows the chosen icon, and the popover offers a
 * searchable grid. The stored value is the icon's kebab-case registry key, so
 * the sidebar (which renders via the same registry) stays in sync.
 */
export function IconPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const Selected = getIconComponent(value || null, Search);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ICON_NAMES;
    return ICON_NAMES.filter((n) => n.includes(q));
  }, [query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Selected className="w-4 h-4 shrink-0 text-slate-500" />
            <span className="truncate text-slate-600">
              {value || t("iconPicker.placeholder", "Выберите иконку")}
            </span>
          </span>
          <ChevronDown className="w-4 h-4 shrink-0 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="relative mb-2">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("iconPicker.search", "Поиск иконки…")}
            className="pl-7 h-8 text-sm"
          />
        </div>
        {value && (
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 mb-2"
          >
            <X className="w-3 h-3" />
            {t("iconPicker.clear", "Очистить")}
          </button>
        )}
        <div className="grid grid-cols-7 gap-1 max-h-56 overflow-y-auto">
          {filtered.map((name) => {
            const Icon = getIconComponent(name, Search);
            const isActive = name === value;
            return (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
                className={cn(
                  "flex items-center justify-center aspect-square rounded-md hover:bg-slate-100 transition-colors",
                  isActive && "bg-blue-50 ring-1 ring-blue-400",
                )}
              >
                <Icon className="w-4 h-4 text-slate-600" />
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="col-span-7 text-center text-xs text-slate-400 py-4">
              {t("iconPicker.empty", "Ничего не найдено")}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
