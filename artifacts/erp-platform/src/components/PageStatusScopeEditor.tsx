import { useGetEntity, useListEntityStatuses, type PageStatusScope } from "@workspace/api-client-react";
import { useI18n, useT } from "@/lib/i18n";
import { CompactStatus } from "@/components/CompactStatus";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PageStatusScopeEditor({ entityId, value, onChange }: {
  entityId: number; value: PageStatusScope | null; onChange: (value: PageStatusScope | null) => void;
}) {
  const { data: statuses = [] } = useListEntityStatuses(entityId);
  const { data: entity } = useGetEntity(entityId);
  const { ml } = useI18n();
  const t = useT();
  return <div className="space-y-3 rounded-md border p-3" data-testid="page-status-scope-editor">
    <Label>{t("pages.statusScope", "Статусы страницы")}</Label>
    <Select value={value ? "selected" : "all"} onValueChange={mode => onChange(mode === "all" ? null : {
      statusIds: [], includeNoStatus: false, allowAllChanges: false,
    })}>
      <SelectTrigger aria-label={t("pages.statusScope", "Статусы страницы")}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{t("pages.statusScopeAll", "Все статусы")}</SelectItem>
        <SelectItem value="selected">{t("pages.statusScopeSelected", "Только выбранные")}</SelectItem>
      </SelectContent>
    </Select>
    {value && <>
      <div className="max-h-56 overflow-y-auto space-y-2">
        {statuses.filter(s => s.isActive).map(status => <label key={status.id} className="flex items-center gap-2 cursor-pointer">
          <Checkbox checked={value.statusIds.includes(status.id)} onCheckedChange={checked => onChange({
            ...value, statusIds: checked ? [...value.statusIds, status.id] : value.statusIds.filter(id => id !== status.id),
          })} />
          <CompactStatus name={ml(status.nameJson)} nameJson={status.nameJson} displayTags={status.displayTags} ml={ml} />
        </label>)}
      </div>
      {entity?.allowNoStatus === true && <label className="flex items-center gap-2 cursor-pointer">
        <Checkbox checked={value.includeNoStatus} onCheckedChange={checked => onChange({ ...value, includeNoStatus: checked === true })} />
        {t("records.noStatus", "Без статуса")}
      </label>}
      <label className="flex items-start gap-2 cursor-pointer">
        <Checkbox checked={value.allowAllChanges} onCheckedChange={checked => onChange({ ...value, allowAllChanges: checked === true })} />
        {t("pages.statusScopeAllChanges", "Показывать все доступные статусы в меню смены статуса")}
      </label>
      <p className="text-xs text-slate-500">{t("pages.statusScopeHint", "Таблица, канбан и фильтр показывают только выбранные статусы. «Показать скрытые» не расширяет этот набор.")}</p>
    </>}
  </div>;
}