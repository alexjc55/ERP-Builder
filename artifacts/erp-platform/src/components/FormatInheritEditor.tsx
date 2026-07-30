import {
  useListEntities,
  useListEntityFields,
  getListEntityFieldsQueryKey,
  type FormatInheritSource,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { useML, useT } from "@/lib/i18n";

/**
 * Editor for a field's `formatInheritJson`: the list of sources this field
 * inherits conditional formatting from. Used when the field's value is copied
 * from another entity by automations (e.g. an order's «Общий статус» filled
 * from an изделие's status): the source's colors follow the value
 * automatically. A source is either another entity's FIELD (its conditional
 * formatting rules) or the entity's record STATUS (status colors).
 */

const STATUS_VALUE = "__status__";

function SourceRow({
  source,
  onChange,
  onRemove,
}: {
  source: FormatInheritSource;
  onChange: (s: FormatInheritSource) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const ml = useML();
  const { data: entities = [] } = useListEntities();
  const entityId = source.entityId ?? null;
  const { data: fields = [] } = useListEntityFields(entityId ?? 0, {
    query: { enabled: entityId != null, queryKey: getListEntityFieldsQueryKey(entityId ?? 0) },
  });

  return (
    <div className="flex items-center gap-2">
      <Select
        value={entityId != null ? String(entityId) : ""}
        onValueChange={(v) => onChange({ kind: source.kind, entityId: Number(v), ...(source.kind === "field" ? { fieldKey: undefined } : {}) })}
      >
        <SelectTrigger className="flex-1 min-w-0">
          <SelectValue placeholder={t("fields.inheritSelectEntity", "Сущность")} />
        </SelectTrigger>
        <SelectContent>
          {entities.map((e) => (
            <SelectItem key={e.id} value={String(e.id)}>
              {ml(e.nameJson)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={source.kind === "status" ? STATUS_VALUE : (source.fieldKey ?? "")}
        onValueChange={(v) =>
          onChange(
            v === STATUS_VALUE
              ? { kind: "status", entityId: entityId ?? undefined }
              : { kind: "field", entityId: entityId ?? undefined, fieldKey: v },
          )
        }
        disabled={entityId == null}
      >
        <SelectTrigger className="flex-1 min-w-0">
          <SelectValue placeholder={t("fields.inheritSelectSource", "Источник")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={STATUS_VALUE}>{t("fields.inheritStatusSource", "Статус записи (цвета статусов)")}</SelectItem>
          {fields
            .filter((f) => f.isActive !== false)
            .map((f) => (
              <SelectItem key={f.fieldKey} value={f.fieldKey}>
                {ml(f.nameJson) || f.fieldKey}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="ghost" size="icon" onClick={onRemove} className="shrink-0 text-slate-400 hover:text-red-500">
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}

export function FormatInheritEditor({
  sources,
  onChange,
}: {
  sources: FormatInheritSource[];
  onChange: (sources: FormatInheritSource[]) => void;
}) {
  const t = useT();
  return (
    <div className="space-y-2">
      <Label>{t("fields.formatInheritTitle", "Наследовать форматирование")}</Label>
      <p className="text-xs text-slate-500">
        {t(
          "fields.formatInheritHint",
          "Если значение этого поля копируется автоматизацией из другого места, укажите источник — цвета (условное форматирование поля или цвета статусов) будут применяться к значению автоматически. Нет совпадения — без форматирования.",
        )}
      </p>
      {sources.map((s, i) => (
        <SourceRow
          key={i}
          source={s}
          onChange={(next) => onChange(sources.map((x, j) => (j === i ? next : x)))}
          onRemove={() => onChange(sources.filter((_, j) => j !== i))}
        />
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...sources, { kind: "status" } as FormatInheritSource])}
        disabled={sources.length >= 10}
      >
        <Plus className="w-4 h-4 mr-1" />
        {t("fields.formatInheritAdd", "Добавить источник")}
      </Button>
    </div>
  );
}
