import { useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Trash2, Plus } from "lucide-react";
import { useT, useML } from "@/lib/i18n";
import { usePagePathLabel } from "@/lib/pagePath";
import {
  useListEntities,
  useListEntityFields,
  useListPages,
  getListPageFieldsQueryOptions,
  type FieldType,
  type PageField,
} from "@workspace/api-client-react";
import { useQueries } from "@tanstack/react-query";

export type GroupFieldRef = 
  | { scope: "entity"; fieldKey: string }
  | { scope: "page"; pageId: number; fieldKey: string };

export type GroupResultConfig = {
  enabled: boolean;
  fields: GroupFieldRef[];
};

export function FormulaGroupResultEditor({
  entityId,
  pageId,
  value,
  onChange,
}: {
  entityId: number;
  pageId?: number;
  value: GroupResultConfig;
  onChange: (value: GroupResultConfig) => void;
}) {
  const t = useT();
  const ml = useML();
  const pageLabel = usePagePathLabel();
  
  const { data: entities = [] } = useListEntities();
  const { data: allPages = [] } = useListPages();
  const { data: entityFields = [] } = useListEntityFields(entityId);
  
  const boundPageId = entities.find((e) => e.id === entityId)?.pageId ?? null;
  const targetPages = useMemo(() => {
    if (pageId != null) {
      return allPages.filter((p) => p.id === pageId);
    }
    return allPages.filter((p) => p.mirrorEntityId === entityId || p.id === boundPageId);
  }, [allPages, entityId, boundPageId, pageId]);
  
  const pageFieldQueries = useQueries({
    queries: targetPages.map((page) => getListPageFieldsQueryOptions(page.id)),
  });
  
  const pageFieldsById = useMemo(() => {
    const map = new Map<number, PageField[]>();
    targetPages.forEach((page, index) => {
      map.set(page.id, pageFieldQueries[index]?.data ?? []);
    });
    return map;
  }, [targetPages, pageFieldQueries]);
  
  const isExcluded = (type: FieldType) =>
    type === "relation" || type === "lookup" || type === "file" || type === "page_ref";
  
  const availableEntityFields = entityFields.filter((f) => !isExcluded(f.fieldType) && f.isActive);
  
  const [selectedToAdd, setSelectedToAdd] = useState<string>("");
  
  const resolveLabel = (ref: GroupFieldRef) => {
    if (ref.scope === "entity") {
      const f = entityFields.find((f) => f.fieldKey === ref.fieldKey);
      return ml(f?.nameJson) || ref.fieldKey;
    } else {
      const f = pageFieldsById.get(ref.pageId)?.find((f) => f.fieldKey === ref.fieldKey);
      const fieldName = ml(f?.nameJson) || ref.fieldKey;
      return `${pageLabel(ref.pageId)} · ${fieldName}`;
    }
  };
  
  const handleAdd = () => {
    if (!selectedToAdd || value.fields.length >= 8) return;
    const [scope, idOrKey, key] = selectedToAdd.split("::");
    let newRef: GroupFieldRef;
    if (scope === "entity") {
      newRef = { scope: "entity", fieldKey: idOrKey };
    } else {
      newRef = { scope: "page", pageId: Number(idOrKey), fieldKey: key };
    }
    if (!value.fields.some(f => f.scope === newRef.scope && (f.scope === "page" && newRef.scope === "page" ? f.pageId === newRef.pageId : true) && f.fieldKey === newRef.fieldKey)) {
      onChange({ ...value, fields: [...value.fields, newRef] });
    }
    setSelectedToAdd("");
  };
  
  const removeRef = (index: number) => {
    const nextFields = [...value.fields];
    nextFields.splice(index, 1);
    onChange({ ...value, fields: nextFields });
  };
  
  return (
    <div className="space-y-4 rounded-md border border-slate-200 bg-slate-50/50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">{t("fields.formulaGroupResult", "Показывать результат один раз на группу")}</Label>
          <p className="text-[13px] text-slate-500">
            {t("fields.formulaGroupResultHint", "Значение формулы будет показано в первой записи каждой комбинации выбранных полей. В остальных строках группы результат будет равен 0, поэтому общие итоги не завышаются.")}
          </p>
        </div>
        <Switch
          checked={value.enabled}
          onCheckedChange={(enabled) => onChange({ ...value, enabled })}
        />
      </div>
      
      {value.enabled && (
        <div className="space-y-3 pt-2">
          {value.fields.length > 0 && (
            <div className="space-y-2">
              {value.fields.map((ref, i) => (
                <div key={i} className="flex items-center justify-between rounded border bg-white px-3 py-2 text-sm shadow-sm">
                  <span>
                    <span className="font-medium">{resolveLabel(ref)}</span>
                    <code className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                      {ref.scope === "entity" ? `{${ref.fieldKey}}` : `{page:${ref.pageId}.${ref.fieldKey}}`}
                    </code>
                  </span>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-red-500" onClick={() => removeRef(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          
          {value.fields.length === 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
              {t("fields.formulaGroupResultEmpty", "Выберите хотя бы одно поле для группировки.")}
            </div>
          )}
          
          {value.fields.length < 8 && (
            <div className="flex gap-2 items-center">
              <Select value={selectedToAdd} onValueChange={setSelectedToAdd}>
                <SelectTrigger className="flex-1 h-9">
                  <SelectValue placeholder={t("fields.formulaAddGroupField", "Выберите поле для группировки...")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t("fields.formulaEntityFields", "Поля сущности")}</SelectLabel>
                    {availableEntityFields.map(f => (
                      <SelectItem key={`entity::${f.fieldKey}`} value={`entity::${f.fieldKey}`}>
                        {ml(f.nameJson) || f.fieldKey}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  {targetPages.map(page => {
                    const pFields = (pageFieldsById.get(page.id) ?? []).filter(f => !isExcluded(f.fieldType) && f.isActive);
                    if (pFields.length === 0) return null;
                    return (
                      <SelectGroup key={`page-${page.id}`}>
                        <SelectLabel>{pageLabel(page.id)}</SelectLabel>
                        {pFields.map(f => (
                          <SelectItem key={`page::${page.id}::${f.fieldKey}`} value={`page::${page.id}::${f.fieldKey}`}>
                            {ml(f.nameJson) || f.fieldKey}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    );
                  })}
                </SelectContent>
              </Select>
              <Button type="button" variant="secondary" size="sm" onClick={handleAdd} disabled={!selectedToAdd} className="h-9">
                <Plus className="mr-1 h-4 w-4" />
                {t("common.add", "Добавить")}
              </Button>
            </div>
          )}
          {value.fields.length >= 8 && (
            <p className="text-xs text-amber-600">{t("fields.formulaGroupMax", "Достигнуто максимальное количество полей (8).")}</p>
          )}
        </div>
      )}
    </div>
  );
}
