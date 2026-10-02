import { type Field, type PageField, type KanbanConfig } from "@workspace/api-client-react";
import { TextDirectionSelect } from "@/components/TextDirectionSelect";
import { Columns3, Plus, ChevronUp, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useML, useT } from "@/lib/i18n";

export type KanbanEditorConfig = KanbanConfig;

export const newKanbanConfig = (): KanbanEditorConfig => ({
  statusTitleHover: false,
  tintColumns: false,
  titleField: null,
  fields: [],
  showLabels: true,
  hideEmptyFields: true,
});

// Same entity/status keys as calendar cards; page-local keys use the API's page: prefix.
const STATUS_KEY = "__status__";
const AUTO_TITLE = "__none__";

export function KanbanConfigEditor({
  value,
  onChange,
  fields,
  pageFields = [],
}: {
  value: KanbanEditorConfig;
  onChange: (config: KanbanEditorConfig) => void;
  fields: Field[];
  pageFields?: PageField[];
}) {
  const ml = useML();
  const t = useT();
  const fieldOptions = [
    ...fields.map((field) => ({ key: field.fieldKey, label: ml(field.nameJson) })),
    ...pageFields.map((field) => ({ key: `page:${field.fieldKey}`, label: `${ml(field.nameJson)} · ${t("kanban.pageFieldSuffix", "поле страницы")}` })),
  ];
  const options = [{ key: STATUS_KEY, label: t("kanban.statusLabel", "Статус") }, ...fieldOptions];
  const available = options.filter((option) => !value.fields.includes(option.key));
  const move = (index: number, direction: -1 | 1) => {
    const next = [...value.fields];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...value, fields: next });
  };

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <Columns3 className="w-4 h-4 text-blue-600" />
        {t("kanban.configTitle", "Конфигурация канбана")}
      </div>
      <p className="text-xs text-slate-500">
        {t("kanban.configHint", "Колонки сгруппированы по статусу записи. Настройте содержимое карточек ниже.")}
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="kanban-title-field">{t("kanban.titleField", "Поле заголовка")}</Label>
        <Select value={value.titleField ?? AUTO_TITLE} onValueChange={(key) => onChange({ ...value, titleField: key === AUTO_TITLE ? null : key })}>
          <SelectTrigger id="kanban-title-field" className="h-8 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO_TITLE}>{t("kanban.titleAuto", "Автоматически (первое текстовое поле)")}</SelectItem>
            {value.titleField && !fieldOptions.some((option) => option.key === value.titleField) && (
              <SelectItem value={value.titleField}>{value.titleField}</SelectItem>
            )}
            {fieldOptions.map((option) => <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>{t("kanban.cardFields", "Поля карточки")}</Label>
          <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" disabled={available.length === 0} onClick={() => onChange({ ...value, fields: [...value.fields, available[0].key] })}>
            <Plus className="w-3.5 h-3.5" />{t("kanban.addField", "Добавить поле")}
          </Button>
        </div>
        <p className="text-xs text-slate-400">{t("kanban.cardFieldsHint", "Поля отображаются под заголовком в указанном порядке. Используйте стрелки для изменения порядка.")}</p>
        {value.fields.length === 0 && <p className="text-xs text-slate-400">{t("kanban.cardFieldsNone", "Только заголовок")}</p>}
        {value.fields.map((key, index) => (
          <div key={`${index}:${key}`} className="flex items-center gap-1.5">
            <Select value={key} onValueChange={(selected) => onChange({ ...value, fields: value.fields.map((current, i) => i === index ? selected : current) })}>
              <SelectTrigger className="h-8 text-sm flex-1 min-w-0" aria-label={t("kanban.cardFields", "Поля карточки")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {!options.some((option) => option.key === key) && <SelectItem value={key}>{key}</SelectItem>}
                {options.filter((option) => option.key === key || !value.fields.includes(option.key)).map((option) => <SelectItem key={option.key} value={option.key}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={index === 0} onClick={() => move(index, -1)} aria-label={t("kanban.moveFieldUp", "Переместить поле выше")}><ChevronUp className="w-3.5 h-3.5" /></Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={index === value.fields.length - 1} onClick={() => move(index, 1)} aria-label={t("kanban.moveFieldDown", "Переместить поле ниже")}><ChevronDown className="w-3.5 h-3.5" /></Button>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-red-500" onClick={() => onChange({ ...value, fields: value.fields.filter((_, i) => i !== index) })} aria-label={t("kanban.removeField", "Удалить поле")}><X className="w-3.5 h-3.5" /></Button>
          </div>
        ))}
      </div>
      <TextDirectionSelect id="kanban-text-direction" showPriorityHint={false} value={value.textDirection ?? null} onChange={(textDirection) => onChange({ ...value, textDirection })} />
      <div className="flex items-center gap-2">
        <Checkbox id="kanban-status-title-hover" checked={value.statusTitleHover ?? false} onCheckedChange={(checked) => onChange({ ...value, statusTitleHover: checked === true })} />
        <Label htmlFor="kanban-status-title-hover">{t("kanban.statusTitleHover", "Цвет заголовка при наведении — по статусу")}</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="kanban-tint-columns" checked={value.tintColumns ?? false} onCheckedChange={(checked) => onChange({ ...value, tintColumns: checked === true })} />
        <Label htmlFor="kanban-tint-columns">{t("kanban.tintColumns", "Подкрашивать колонки по цвету статуса")}</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="kanban-show-labels" checked={value.showLabels} onCheckedChange={(checked) => onChange({ ...value, showLabels: checked === true })} />
        <Label htmlFor="kanban-show-labels">{t("kanban.showLabels", "Показывать названия полей")}</Label>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="kanban-hide-empty-fields" checked={value.hideEmptyFields} onCheckedChange={(checked) => onChange({ ...value, hideEmptyFields: checked === true })} />
        <Label htmlFor="kanban-hide-empty-fields">{t("kanban.hideEmptyFields", "Скрывать пустые поля")}</Label>
      </div>
    </div>
  );
}