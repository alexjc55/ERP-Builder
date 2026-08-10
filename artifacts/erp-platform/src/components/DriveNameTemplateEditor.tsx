import { useState } from "react";
import {
  useListEntities,
  useListEntityFields,
  useListPages,
  useListPageFields,
  getListEntityFieldsQueryKey,
  getListPageFieldsQueryKey,
} from "@workspace/api-client-react";
import { useML } from "@/lib/i18n";
import { usePagePathLabel } from "@/lib/pagePath";
import { driveNameHash, driveNameDate, type DriveNameSection } from "@/lib/driveNaming";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Plus, Trash2, Type } from "lucide-react";

type TFn = (key: string, fallback: string) => string;

/**
 * One "field value" section editor. A section can hold SEVERAL field variants
 * (the same logical field, e.g. "order number", lives under different keys in
 * different entities/pages). At upload time the first variant with a non-empty
 * value in the record wins.
 */
function FieldSectionPicker({
  section,
  onChange,
  t,
  defaultSource,
}: {
  section: Extract<DriveNameSection, { kind: "field" }>;
  onChange: (s: DriveNameSection) => void;
  t: TFn;
  /** Preselected source, e.g. "e:12" for the entity owning the field being configured. */
  defaultSource?: string;
}) {
  const ml = useML();
  const pageLabel = usePagePathLabel();
  const { data: entities = [] } = useListEntities();
  const { data: pages = [] } = useListPages();
  // Source of the field being added: "e:<entityId>" or "p:<pageId>" (page-local).
  const [source, setSource] = useState<string>(defaultSource ?? "");
  const entityId = source.startsWith("e:") ? Number(source.slice(2)) : 0;
  const pageId = source.startsWith("p:") ? Number(source.slice(2)) : 0;
  const { data: entityFields = [] } = useListEntityFields(entityId, {
    query: { enabled: entityId > 0, queryKey: getListEntityFieldsQueryKey(entityId) },
  });
  const { data: pageFields = [] } = useListPageFields(pageId, {
    query: { enabled: pageId > 0, queryKey: getListPageFieldsQueryKey(pageId) },
  });
  const sourceLabel = entityId > 0
    ? ml(entities.find((e) => e.id === entityId)?.nameJson) || ""
    : pageId > 0
      ? pageLabel(pageId)
      : "";
  const fieldOptions = (entityId > 0 ? entityFields : pageFields).map((f) => ({
    key: f.fieldKey,
    label: `${ml(f.nameJson) || f.fieldKey}${sourceLabel ? ` (${sourceLabel})` : ""}`,
  }));

  // Chosen variants: primary + alts, in order.
  const variants: { fieldKey: string; label?: string }[] = section.fieldKey
    ? [{ fieldKey: section.fieldKey, label: section.label }, ...(section.alts ?? [])]
    : [];

  const commit = (next: { fieldKey: string; label?: string }[]) => {
    const [first, ...rest] = next;
    onChange(
      first
        ? { kind: "field", fieldKey: first.fieldKey, label: first.label, alts: rest.length > 0 ? rest : undefined }
        : { kind: "field", fieldKey: "" },
    );
  };

  const addVariant = (key: string) => {
    if (variants.some((v) => v.fieldKey === key)) return;
    const opt = fieldOptions.find((f) => f.key === key);
    commit([...variants, { fieldKey: key, label: opt?.label ?? key }]);
  };

  return (
    <div className="flex-1 min-w-0 space-y-1.5">
      {variants.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {variants.map((v, idx) => (
            <Badge key={v.fieldKey} variant="secondary" className="gap-1 font-normal max-w-full">
              <span className="truncate">{v.label || v.fieldKey}</span>
              {idx === 0 && variants.length > 1 && (
                <span className="text-[10px] text-slate-400">{t("gdrive.tplPrimary", "осн.")}</span>
              )}
              <button
                type="button"
                className="text-slate-400 hover:text-red-600"
                onClick={() => commit(variants.filter((x) => x.fieldKey !== v.fieldKey))}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="h-8 w-[170px] text-xs">
            <SelectValue placeholder={t("gdrive.tplPickSource", "Сущность / страница")} />
          </SelectTrigger>
          <SelectContent>
            {entities.map((e) => (
              <SelectItem key={`e:${e.id}`} value={`e:${e.id}`}>{ml(e.nameJson)}</SelectItem>
            ))}
            {pages.filter((p) => (p as { pageType?: string }).pageType !== "dashboard").map((p) => (
              <SelectItem key={`p:${p.id}`} value={`p:${p.id}`}>
                {t("gdrive.tplPagePrefix", "Стр.")} {pageLabel(p.id)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value="" onValueChange={addVariant} disabled={!source}>
          <SelectTrigger className="h-8 w-[190px] text-xs">
            <SelectValue placeholder={variants.length > 0 ? t("gdrive.tplAddVariant", "Добавить вариант поля") : t("gdrive.tplPickField", "Поле")} />
          </SelectTrigger>
          <SelectContent>
            {fieldOptions.map((f) => (
              <SelectItem key={f.key} value={f.key} disabled={variants.some((v) => v.fieldKey === f.key)}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {variants.length > 1 && (
        <p className="text-[11px] text-slate-400">
          {t("gdrive.tplVariantsHint", "Подставится первое поле, у которого в записи есть значение.")}
        </p>
      )}
    </div>
  );
}

/**
 * Shared editor for a Drive file-name template (list of sections + live
 * preview). Used by the folder settings dialog (admin → Google Drive) and by
 * the file-field config (per-field template that overrides the folder's).
 */
export function DriveNameTemplateEditor({
  sections,
  onChange,
  t,
  defaultSource,
}: {
  sections: DriveNameSection[];
  onChange: (next: DriveNameSection[]) => void;
  t: TFn;
  defaultSource?: string;
}) {
  const setSection = (i: number, s: DriveNameSection) => onChange(sections.map((x, idx) => (idx === i ? s : x)));
  const removeSection = (i: number) => onChange(sections.filter((_, idx) => idx !== i));
  const addSection = () => onChange([...sections, { kind: "text", text: "" }]);

  const preview = sections.length > 0
    ? sections
        .map((s) =>
          s.kind === "text"
            ? (s.text ?? "").trim()
            : s.kind === "hash"
              ? driveNameHash()
              : s.kind === "date"
                ? driveNameDate()
                : s.kind === "user"
                  ? "ivan.petrov"
                  : s.label || s.fieldKey
                  ? `«${s.label || s.fieldKey}»`
                  : "",
        )
        .filter(Boolean)
        .join("_") + ".pdf"
    : null;

  return (
    <div className="space-y-2">
      {sections.map((s, i) => (
        <div key={i} className="flex items-start gap-1.5 rounded-md border border-slate-100 p-2">
          <Select
            value={s.kind}
            onValueChange={(kind) =>
              setSection(
                i,
                kind === "text"
                  ? { kind: "text", text: "" }
                  : kind === "field"
                    ? { kind: "field", fieldKey: "" }
                    : kind === "date"
                      ? { kind: "date" }
                      : kind === "user"
                        ? { kind: "user" }
                        : { kind: "hash" },
              )
            }
          >
            <SelectTrigger className="h-8 w-[150px] text-xs shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">{t("gdrive.tplKindText", "Текст")}</SelectItem>
              <SelectItem value="field">{t("gdrive.tplKindField", "Значение поля")}</SelectItem>
              <SelectItem value="hash">{t("gdrive.tplKindHash", "Авто-хеш")}</SelectItem>
              <SelectItem value="date">{t("gdrive.tplKindDate", "Дата и время")}</SelectItem>
              <SelectItem value="user">{t("gdrive.tplKindUser", "Пользователь")}</SelectItem>
            </SelectContent>
          </Select>
          {s.kind === "text" && (
            <Input
              className="h-8 flex-1 text-sm"
              value={s.text ?? ""}
              onChange={(e) => setSection(i, { kind: "text", text: e.target.value })}
              placeholder={t("gdrive.tplTextPlaceholder", "Произвольный текст")}
            />
          )}
          {s.kind === "field" && (
            <FieldSectionPicker section={s} onChange={(next) => setSection(i, next)} t={t} defaultSource={defaultSource} />
          )}
          {s.kind === "hash" && (
            <span className="self-center flex-1 text-xs text-slate-500">
              {t("gdrive.tplHashHint", "Случайный код, например")} {`${driveNameHash()}`}
            </span>
          )}
          {s.kind === "user" && (
            <span className="self-center flex-1 text-xs text-slate-500">
              {t("gdrive.tplUserHint", "Логин загрузившего (часть email до @), например ivan.petrov")}
            </span>
          )}
          {s.kind === "date" && (
            <span className="self-center flex-1 text-xs text-slate-500">
              {t("gdrive.tplDateHint", "Дата и время загрузки, например")} {driveNameDate()}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-red-600 hover:text-red-700"
            onClick={() => removeSection(i)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addSection}>
        <Plus className="w-4 h-4 mr-1" />
        {t("gdrive.tplAddSection", "Добавить секцию")}
      </Button>
      {preview && (
        <p className="text-sm text-slate-600">
          <Type className="w-3.5 h-3.5 inline mr-1 text-slate-400" />
          {t("gdrive.tplPreview", "Пример:")} <span className="font-mono">{preview}</span>
        </p>
      )}
    </div>
  );
}
