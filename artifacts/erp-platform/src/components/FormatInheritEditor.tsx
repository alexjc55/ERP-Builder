import {
  useListEntities,
  useListEntityFields,
  useListPages,
  useListPageFields,
  getListEntityFieldsQueryKey,
  getListPageFieldsQueryKey,
  type FormatInheritSource,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { useML, useT } from "@/lib/i18n";

/**
 * Editor for a field's `formatInheritJson`: the list of sources this field
 * inherits conditional formatting from. Used when the field's value is copied
 * from elsewhere by automations (e.g. an order's «Общий статус» filled from an
 * изделие's status): the source's colors follow the value automatically.
 * A source container is either an ENTITY (its record status colors or one of
 * its fields' rules) or a MIRROR PAGE (one of its page-local fields' rules).
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
  const { data: pages = [] } = useListPages();
  // Only mirror pages can carry page-local fields.
  const mirrorPages = pages.filter((p) => p.mirrorEntityId != null && p.isActive !== false);

  const isPage = source.kind === "pageField";
  const entityId = !isPage ? (source.entityId ?? null) : null;
  const pageId = isPage ? (source.pageId ?? null) : null;

  const { data: fields = [] } = useListEntityFields(entityId ?? 0, {
    query: { enabled: entityId != null, queryKey: getListEntityFieldsQueryKey(entityId ?? 0) },
  });
  const { data: pageFields = [] } = useListPageFields(pageId ?? 0, {
    query: { enabled: pageId != null, queryKey: getListPageFieldsQueryKey(pageId ?? 0) },
  });

  const containerValue = entityId != null ? `e:${entityId}` : pageId != null ? `p:${pageId}` : "";

  return (
    <div className="flex items-center gap-2">
      <Select
        value={containerValue}
        onValueChange={(v) => {
          const id = Number(v.slice(2));
          if (v.startsWith("p:")) {
            // Switching to a page: only pageField sources make sense.
            onChange({ kind: "pageField", pageId: id } as FormatInheritSource);
          } else if (source.kind === "status") {
            onChange({ kind: "status", entityId: id });
          } else {
            // Entity change invalidates the picked field.
            onChange({ kind: "field", entityId: id } as FormatInheritSource);
          }
        }}
      >
        <SelectTrigger className="flex-1 min-w-0">
          <SelectValue placeholder={t("fields.inheritSelectEntity", "Сущность или страница")} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{t("fields.inheritEntitiesGroup", "Сущности")}</SelectLabel>
            {entities.map((e) => (
              <SelectItem key={`e:${e.id}`} value={`e:${e.id}`}>
                {ml(e.nameJson)}
              </SelectItem>
            ))}
          </SelectGroup>
          {mirrorPages.length > 0 && (
            <SelectGroup>
              <SelectLabel>{t("fields.inheritPagesGroup", "Страницы")}</SelectLabel>
              {mirrorPages.map((p) => (
                <SelectItem key={`p:${p.id}`} value={`p:${p.id}`}>
                  {ml(p.nameJson)}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      <Select
        value={source.kind === "status" ? STATUS_VALUE : (source.fieldKey ?? "")}
        onValueChange={(v) => {
          if (isPage) {
            onChange({ kind: "pageField", pageId: pageId ?? undefined, fieldKey: v } as FormatInheritSource);
          } else {
            onChange(
              v === STATUS_VALUE
                ? ({ kind: "status", entityId: entityId ?? undefined } as FormatInheritSource)
                : ({ kind: "field", entityId: entityId ?? undefined, fieldKey: v } as FormatInheritSource),
            );
          }
        }}
        disabled={entityId == null && pageId == null}
      >
        <SelectTrigger className="flex-1 min-w-0">
          <SelectValue placeholder={t("fields.inheritSelectSource", "Источник")} />
        </SelectTrigger>
        <SelectContent>
          {!isPage && (
            <SelectItem value={STATUS_VALUE}>{t("fields.inheritStatusSource", "Статус записи (цвета статусов)")}</SelectItem>
          )}
          {(isPage ? pageFields : fields)
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
          "Если значение этого поля копируется автоматизацией из другого места, укажите источник — цвета (условное форматирование поля, поля страницы или цвета статусов) будут применяться к значению автоматически. Нет совпадения — без форматирования.",
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
