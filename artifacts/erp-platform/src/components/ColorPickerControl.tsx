import { useState, type ChangeEvent, type FocusEvent } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/lib/i18n";
import { addColorPreset, loadColorPresets, removeColorPreset } from "@/lib/colorPresets";
import { Star, X } from "lucide-react";
import { HexColorPicker } from "react-colorful";

/**
 * Normalize a user-typed color into either "" (no color) or an uppercase
 * #RRGGBB hex. Accepts shorthand #RGB and tolerates a missing leading "#".
 * Returns null for values that are not (yet) valid hex.
 */
function normalizeHexColor(raw: string): string | null {
  const v = raw.trim();
  if (v === "") return "";
  const body = (v.startsWith("#") ? v.slice(1) : v).toLowerCase();
  if (/^[0-9a-f]{3}$/.test(body)) {
    return `#${body[0]}${body[0]}${body[1]}${body[1]}${body[2]}${body[2]}`.toUpperCase();
  }
  if (/^[0-9a-f]{6}$/.test(body)) {
    return `#${body}`.toUpperCase();
  }
  return null;
}

/**
 * Reusable hex color control (swatch + popover picker + saved-presets palette +
 * text input + clear). Value is "" for "no color" or a #RRGGBB hex. Shares the
 * same localStorage palette as the conditional-formatting color controls.
 */
export function ColorPickerControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const t = useT();
  const [presets, setPresets] = useState<string[]>(() => loadColorPresets());
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  const swatch = valid ? value : "#ffffff";
  const onTextChange = (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.trim();
    onChange(v === "" ? "" : v.startsWith("#") ? v : `#${v}`);
  };
  const onTextBlur = (e: FocusEvent<HTMLInputElement>) => {
    const normalized = normalizeHexColor(e.target.value);
    if (normalized !== null && normalized !== value) onChange(normalized);
  };
  const checkerboard =
    "linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%),linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%)";
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-slate-500 w-24 shrink-0">{label}</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="h-7 w-9 rounded border border-slate-200 cursor-pointer shrink-0"
            style={{ backgroundColor: swatch, backgroundImage: valid ? undefined : checkerboard, backgroundSize: "8px 8px", backgroundPosition: "0 0,4px 4px" }}
            aria-label={t("fields.pickColor", "Выбрать цвет")}
            title={t("fields.pickColor", "Выбрать цвет")}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="format-color-picker">
            <HexColorPicker color={swatch} onChange={onChange} />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Input
              className="h-7 w-[150px] font-mono text-xs"
              value={value}
              onChange={onTextChange}
              onBlur={onTextBlur}
              placeholder="#RRGGBB"
              spellCheck={false}
            />
            <button
              type="button"
              disabled={!valid}
              onClick={() => setPresets((prev) => addColorPreset(prev, value))}
              className="flex items-center gap-1 h-7 px-2 rounded border border-slate-200 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
              title={t("fields.savePreset", "Сохранить цвет в палитру")}
            >
              <Star className="w-3.5 h-3.5" />
              {t("fields.savePreset", "Сохранить")}
            </button>
          </div>
          <div className="mt-3 w-[200px]">
            <p className="text-xs text-slate-500 mb-1">{t("fields.savedColors", "Сохранённые цвета")}</p>
            {presets.length === 0 ? (
              <p className="text-xs text-slate-400">{t("fields.noSavedColors", "Пока пусто — сохраните цвет кнопкой ★")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => (
                  <div key={p} className="relative group">
                    <button
                      type="button"
                      onClick={() => onChange(p)}
                      className="h-6 w-6 rounded border border-slate-200 shrink-0"
                      style={{ backgroundColor: p }}
                      title={p}
                      aria-label={`${t("fields.useColor", "Использовать цвет")} ${p}`}
                    />
                    <button
                      type="button"
                      onClick={() => setPresets((prev) => removeColorPreset(prev, p))}
                      className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center h-3.5 w-3.5 rounded-full bg-slate-600 text-white"
                      title={t("fields.removePreset", "Удалить из палитры")}
                      aria-label={`${t("fields.removePreset", "Удалить из палитры")} ${p}`}
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Input
        className="h-7 w-24 font-mono text-xs"
        value={value}
        onChange={onTextChange}
        onBlur={onTextBlur}
        placeholder="#RRGGBB"
        spellCheck={false}
      />
      {value ? (
        <button
          type="button"
          className="text-xs text-slate-400 hover:text-slate-600"
          aria-label={t("fields.clearColor", "Очистить цвет")}
          title={t("fields.clearColor", "Очистить цвет")}
          onClick={() => onChange("")}
        >
          ✕
        </button>
      ) : null}
    </div>
  );
}
