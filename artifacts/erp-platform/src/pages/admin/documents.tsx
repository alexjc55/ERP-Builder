import { useEffect, useState, type ReactElement } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListDocumentTemplatesQueryKey,
  getListEntityFieldsQueryKey,
  getGetRelationQueryKey,
  getListGoogleDriveFoldersQueryKey,
  getListDocumentGenerationRunsQueryKey,
  getListLocalFoldersQueryKey,
  useCreateDocumentTemplate,
  useCreateDocumentTemplateRevision,
  useGetRelation,
  useListDocumentTemplates,
  useListEntities,
  useListEntityFields,
  useListEntityRecords,
  useListGoogleDriveFolders,
  useListDocumentGenerationRuns,
  useListLocalFolders,
  useListModules,
  usePublishDocumentTemplateRevision,
  useResolveDocumentGenerationOrphan,
  useTestDocumentTemplateRevision,
  useUpdateDocumentTemplate,
  type DocumentOrphanActionInputAction,
  type DocumentTemplate,
  type DocumentTemplateRevision,
  type Entity,
  type Field,
  type MultilingualText,
} from "@workspace/api-client-react";
import { useML, useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { gdriveContentUrl, objectServingUrl } from "@/lib/storage";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  CircleCheck,
  Download,
  ExternalLink,
  FileText,
  Plus,
  Save,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  X,
  Upload,
} from "lucide-react";

type ValueSource =
  | { source: "field"; fieldKey: string }
  | { source: "status" }
  | { source: "system"; key: "record_id" | "generated_at" }
  | { source: "literal"; value: string }
  | { source: "blank" };
type CollectionFilter = { fieldKey: string; operator: "eq" | "neq" | "contains" | "empty" | "notEmpty"; value?: unknown };
type CollectionConfig = {
  relationFieldKey: string;
  filters: CollectionFilter[];
  sort: { fieldKey: string; direction: "asc" | "desc" }[];
  fields: Record<string, ValueSource>;
};
type Mapping = { scalars: Record<string, ValueSource>; collections: Record<string, CollectionConfig> };
type Output = {
  outputFormat: "docx" | "pdf";
  destination: "local" | "gdrive";
  localFolderId?: number;
  driveFolderId?: string;
  targetFileFieldKey: string;
  filenameTemplate: string;
  overwrite: "replace" | "error";
};
type Manifest = { scalars?: string[]; collections?: Record<string, string[]>; errors?: string[] };
type OrphanRecoveryRequest = { runId: number; action: DocumentOrphanActionInputAction };

const emptyMapping = (): Mapping => ({ scalars: {}, collections: {} });
const defaultOutput = (): Output => ({ outputFormat: "docx", destination: "local", targetFileFieldKey: "", filenameTemplate: "document", overwrite: "replace" });
const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const sourceComplete = (s?: ValueSource) =>
  !!s && (s.source === "blank" || s.source === "status" || (s.source === "field" && !!s.fieldKey) ||
    (s.source === "system" && !!s.key) || (s.source === "literal" && s.value !== undefined));

function extractError(error: unknown): string {
  if (error && typeof error === "object" && "response" in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    if (response?.data?.error) return response.data.error;
  }
  return error instanceof Error ? error.message : String(error);
}

type Translator = (key: string, fallback: string) => string;

const interpolate = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);

const documentErrorPatterns: Array<{
  pattern: RegExp;
  key: string;
  fallback: string;
  names: string[];
}> = [
  { pattern: /^Unsupported or malformed marker in (.+)$/, key: "documents.error.markerMalformed", fallback: "Неподдерживаемый или некорректный маркер в части «{part}»", names: ["part"] },
  { pattern: /^Invalid table-row collection markers in (.+)$/, key: "documents.error.tableMarkersInvalid", fallback: "Некорректные маркеры коллекции в строке таблицы в части «{part}»", names: ["part"] },
  { pattern: /^Collection markers must be in the first and last cells in (.+)$/, key: "documents.error.tableMarkersPosition", fallback: "Маркеры коллекции должны находиться в первой и последней ячейках в части «{part}»", names: ["part"] },
  { pattern: /^Duplicate collection row "([^"]+)" in (.+)$/, key: "documents.error.duplicateCollectionRow", fallback: "Повторяющаяся строка коллекции «{collection}» в части «{part}»", names: ["collection", "part"] },
  { pattern: /^Collection marker outside one repeatable row in (.+): (.+)$/, key: "documents.error.collectionMarkerOutsideRow", fallback: "Маркер коллекции находится вне одной повторяемой строки в части «{part}»: {marker}", names: ["part", "marker"] },
  { pattern: /^Unknown field "([^"]+)" for "([^"]+)"$/, key: "documents.error.unknownField", fallback: "Неизвестное поле «{field}» для «{context}»", names: ["field", "context"] },
  { pattern: /^Unknown page-local field "([^"]+)" for "([^"]+)"$/, key: "documents.error.unknownPageField", fallback: "Неизвестное локальное поле страницы «{field}» для «{context}»", names: ["field", "context"] },
  { pattern: /^Missing mapping for scalar "([^"]+)"$/, key: "documents.error.missingScalarMapping", fallback: "Не задано сопоставление для скалярного маркера «{name}»", names: ["name"] },
  { pattern: /^Mapping has no scalar marker "([^"]+)"$/, key: "documents.error.extraScalarMapping", fallback: "В шаблоне нет скалярного маркера «{name}» из сопоставления", names: ["name"] },
  { pattern: /^Missing mapping for collection "([^"]+)"$/, key: "documents.error.missingCollectionMapping", fallback: "Не задано сопоставление для коллекции «{name}»", names: ["name"] },
  { pattern: /^Collection "([^"]+)" must use a relation field$/, key: "documents.error.collectionNeedsRelation", fallback: "Для коллекции «{name}» необходимо выбрать поле связи", names: ["name"] },
  { pattern: /^Collection "([^"]+)" references a missing relation$/, key: "documents.error.collectionMissingRelation", fallback: "Коллекция «{name}» ссылается на отсутствующую связь", names: ["name"] },
  { pattern: /^Unknown linked filter field "([^"]+)" for "([^"]+)"$/, key: "documents.error.unknownFilterField", fallback: "Неизвестное поле фильтра «{field}» для коллекции «{collection}»", names: ["field", "collection"] },
  { pattern: /^Collection "([^"]+)" relation is not configured$/, key: "documents.error.collectionRelationUnconfigured", fallback: "Связь для коллекции «{name}» не настроена", names: ["name"] },
  { pattern: /^Missing mapping for "([^"]+)"$/, key: "documents.error.missingMapping", fallback: "Не задано сопоставление для «{name}»", names: ["name"] },
  { pattern: /^Mapping has no collection marker "([^"]+)"$/, key: "documents.error.extraCollectionMapping", fallback: "В шаблоне нет маркера коллекции «{name}» из сопоставления", names: ["name"] },
  { pattern: /^Unknown sort key "([^"]+)"$/, key: "documents.error.unknownSortKey", fallback: "Неизвестный ключ сортировки «{name}»", names: ["name"] },
  { pattern: /^Duplicate DOCX relationship attribute: (.+)$/, key: "documents.error.duplicateRelationshipAttribute", fallback: "Повторяющийся атрибут связи DOCX: {name}", names: ["name"] },
  { pattern: /^DOCX entry is too large: (.+)$/, key: "documents.error.entryTooLarge", fallback: "Элемент DOCX слишком велик: {name}", names: ["name"] },
  { pattern: /^DOCX XML (?:part )?is too large: (.+)$/, key: "documents.error.xmlPartTooLarge", fallback: "XML-часть DOCX слишком велика: {name}", names: ["name"] },
  { pattern: /^DOCX XML contains prohibited DTD\/entity: (.+)$/, key: "documents.error.prohibitedXml", fallback: "XML в DOCX содержит запрещённый DTD или сущность: {name}", names: ["name"] },
];

const knownDocumentErrors: Record<string, [string, string]> = {
  "Invalid DOCX revision request": ["documents.error.invalidRevisionRequest", "Некорректный запрос на создание редакции DOCX"],
  "Invalid mapping configuration": ["documents.error.invalidMapping", "Некорректная конфигурация сопоставления"],
  "Invalid DOCX": ["documents.error.invalidDocx", "Некорректный файл DOCX"],
  "File is not a valid DOCX document": ["documents.error.invalidDocx", "Некорректный файл DOCX"],
  "DOCX size is outside the allowed range": ["documents.error.docxSize", "Размер DOCX выходит за допустимые пределы"],
  "DOCX contains too many archive entries": ["documents.error.tooManyEntries", "DOCX содержит слишком много элементов"],
  "DOCX contains an unsafe archive path": ["documents.error.unsafeArchivePath", "DOCX содержит небезопасный путь в архиве"],
  "DOCX expanded content is too large": ["documents.error.expandedTooLarge", "Распакованное содержимое DOCX слишком велико"],
  "DOCX external relationships are not allowed": ["documents.error.externalRelationships", "Внешние связи в DOCX запрещены"],
  "Malformed XML entity in DOCX relationship attribute": ["documents.error.malformedDocx", "Некорректная структура XML в DOCX"],
  "Malformed XML in DOCX": ["documents.error.malformedDocx", "Некорректная структура XML в DOCX"],
  "Malformed XML element nesting in DOCX": ["documents.error.malformedDocx", "Некорректная структура XML в DOCX"],
  "Malformed XML element in DOCX": ["documents.error.malformedDocx", "Некорректная структура XML в DOCX"],
  "Unclosed XML element in DOCX": ["documents.error.malformedDocx", "Некорректная структура XML в DOCX"],
  "Malformed DOCX relationship attribute": ["documents.error.malformedRelationship", "Некорректный атрибут связи DOCX"],
  "Malformed DOCX relationship": ["documents.error.malformedRelationship", "Некорректная связь DOCX"],
  "Document generation module is disabled": ["documents.error.moduleDisabled", "Модуль создания документов отключён"],
  "Template not found": ["documents.error.templateNotFound", "Шаблон не найден"],
  "Document revision not found": ["documents.error.revisionNotFound", "Редакция документа не найдена"],
  "Publishable draft not found": ["documents.error.publishableDraftNotFound", "Черновик для публикации не найден"],
  "Draft has incomplete or invalid mappings": ["documents.error.invalidDraftMappings", "В черновике есть неполные или некорректные сопоставления"],
  "Invalid test generation request": ["documents.error.invalidTestRequest", "Некорректный запрос тестового создания документа"],
  "Invalid generation request": ["documents.error.invalidGenerationRequest", "Некорректный запрос создания документа"],
  "Invalid output settings": ["documents.error.invalidOutput", "Некорректные настройки результата"],
  "Test generation did not produce a download": ["documents.error.noTestDownload", "Тестовое создание не сформировало файл для скачивания"],
  "Generation failed": ["documents.error.generationFailed", "Не удалось создать документ"],
  "Record not found": ["documents.error.recordNotFound", "Запись не найдена"],
  "Entity not found": ["documents.error.entityNotFound", "Сущность не найдена"],
  "Forbidden": ["documents.error.forbidden", "Недостаточно прав для выполнения действия"],
};

function localizeDocumentError(message: unknown, t: Translator): string {
  const raw = safeErrorText(typeof message === "string" ? message : extractError(message)).trim();
  const invalidMarkers = /^DOCX has invalid markers:\s*(.+)$/.exec(raw);
  if (invalidMarkers) {
    const details = invalidMarkers[1].split(/;\s*/).map((item) => localizeDocumentError(item, t)).join("; ");
    return interpolate(t("documents.error.invalidMarkers", "DOCX содержит некорректные маркеры: {details}"), { details });
  }
  const known = knownDocumentErrors[raw];
  if (known) return t(known[0], known[1]);
  for (const entry of documentErrorPatterns) {
    const match = entry.pattern.exec(raw);
    if (!match) continue;
    const values = Object.fromEntries(entry.names.map((name, index) => [name, match[index + 1] ?? ""]));
    return interpolate(t(entry.key, entry.fallback), values);
  }
  return t("documents.error.generic", "Не удалось выполнить действие с документом. Проверьте настройки и повторите попытку.");
}

const readableSize = (bytes?: number): string => {
  if (bytes == null || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
const safeErrorText = (value?: string): string =>
  (value ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/[<>]/g, "").slice(0, 1000);
const testDownloadName = (templateName: string, format: "docx" | "pdf"): string => {
  const base = templateName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9\u0590-\u05FF\u0400-\u04FF_-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
  return `${base}-test.${format}`;
};

function ValueMappingEditor({
  value,
  fields,
  onChange,
  t,
  ml,
}: {
  value?: ValueSource;
  fields: Field[];
  onChange: (value: ValueSource) => void;
  t: (key: string, fallback: string) => string;
  ml: (value: MultilingualText | string | null | undefined) => string;
}) {
  const kind = value?.source ?? "";
  return (
    <div className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)]">
      <Select
        value={kind}
        onValueChange={(next) => {
          if (next === "field") onChange({ source: "field", fieldKey: fields[0]?.fieldKey ?? "" });
          else if (next === "system") onChange({ source: "system", key: "record_id" });
          else if (next === "literal") onChange({ source: "literal", value: "" });
          else if (next === "status") onChange({ source: "status" });
          else onChange({ source: "blank" });
        }}
      >
        <SelectTrigger data-testid="select-mapping-source"><SelectValue placeholder={t("documents.chooseSource", "Выберите источник")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="field">{t("documents.source.field", "Поле сущности / формула")}</SelectItem>
          <SelectItem value="status">{t("documents.source.status", "Статус записи")}</SelectItem>
          <SelectItem value="system">{t("documents.source.system", "Системное значение")}</SelectItem>
          <SelectItem value="literal">{t("documents.source.literal", "Постоянный текст")}</SelectItem>
          <SelectItem value="blank">{t("documents.source.blank", "Намеренно пусто")}</SelectItem>
        </SelectContent>
      </Select>
      {value?.source === "field" && (
        <Select value={value.fieldKey} onValueChange={(fieldKey) => onChange({ source: "field", fieldKey })}>
          <SelectTrigger data-testid="select-mapping-field"><SelectValue placeholder={t("documents.chooseField", "Выберите поле")} /></SelectTrigger>
          <SelectContent>{fields.map((f) => (
            <SelectItem key={f.fieldKey} value={f.fieldKey}>
              {ml(f.nameJson) || f.fieldKey}{f.fieldType === "function" ? ` · ${t("documents.formula", "формула")}` : ""}
            </SelectItem>
          ))}</SelectContent>
        </Select>
      )}
      {value?.source === "system" && (
        <Select value={value.key} onValueChange={(key) => onChange({ source: "system", key: key as "record_id" | "generated_at" })}>
          <SelectTrigger data-testid="select-system-value"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="record_id">{t("documents.system.recordId", "ID записи")}</SelectItem>
            <SelectItem value="generated_at">{t("documents.system.generatedAt", "Дата и время создания")}</SelectItem>
          </SelectContent>
        </Select>
      )}
      {value?.source === "literal" && (
        <Input data-testid="input-literal-value" value={value.value} onChange={(e) => onChange({ source: "literal", value: e.target.value })} />
      )}
      {value?.source === "blank" && <p className="self-center text-xs text-slate-500">{t("documents.blankHint", "Этот тег намеренно выводится пустым.")}</p>}
    </div>
  );
}

function CollectionEditor({
  name,
  tags,
  value,
  relationFields,
  currentEntityId,
  onChange,
  t,
  ml,
}: {
  name: string;
  tags: string[];
  value?: CollectionConfig;
  relationFields: Field[];
  currentEntityId: number;
  onChange: (value: CollectionConfig) => void;
  t: (key: string, fallback: string) => string;
  ml: (value: MultilingualText | string | null | undefined) => string;
}) {
  const relationField = relationFields.find((f) => f.fieldKey === value?.relationFieldKey);
  const relationId = relationField?.relationConfigJson?.relationId ?? 0;
  const { data: relation } = useGetRelation(relationId, {
    query: { enabled: relationId > 0, queryKey: getGetRelationQueryKey(relationId) },
  });
  const relatedEntityId = relation
    ? (relation.sourceEntityId === currentEntityId ? relation.targetEntityId : relation.sourceEntityId)
    : 0;
  const { data: linkedFieldsRaw = [] } = useListEntityFields(relatedEntityId, {
    query: { enabled: relatedEntityId > 0, queryKey: getListEntityFieldsQueryKey(relatedEntityId) },
  });
  const linkedFields = [...linkedFieldsRaw].filter((f) => f.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const config: CollectionConfig = value ?? { relationFieldKey: "", filters: [], sort: [], fields: {} };
  const patch = (next: Partial<CollectionConfig>) => onChange({ ...config, ...next });
  const firstSort = config.sort[0];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4" data-testid={`collection-${name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="font-semibold text-slate-800">{name}</p><p className="text-xs text-slate-500">{tags.length} {t("documents.childTags", "дочерних тегов")}</p></div>
        <Select value={config.relationFieldKey} onValueChange={(relationFieldKey) => onChange({ relationFieldKey, filters: [], sort: [], fields: {} })}>
          <SelectTrigger className="w-64" data-testid={`select-relation-${name}`}><SelectValue placeholder={t("documents.chooseRelation", "Выберите связь")} /></SelectTrigger>
          <SelectContent>{relationFields.map((f) => <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {config.relationFieldKey && (
        <>
          <div className="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)_130px] items-center">
            <Label>{t("documents.sort", "Сортировка")}</Label>
            <Select value={firstSort?.fieldKey ?? "__none"} onValueChange={(fieldKey) => patch({ sort: fieldKey === "__none" ? [] : [{ fieldKey, direction: firstSort?.direction ?? "asc" }] })}>
              <SelectTrigger data-testid={`select-sort-${name}`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__none">{t("documents.noSort", "Исходный порядок")}</SelectItem>{linkedFields.map((field) => <SelectItem key={field.fieldKey} value={field.fieldKey}>{ml(field.nameJson) || field.fieldKey}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={firstSort?.direction ?? "asc"} disabled={!firstSort} onValueChange={(direction) => firstSort && patch({ sort: [{ ...firstSort, direction: direction as "asc" | "desc" }] })}>
              <SelectTrigger data-testid={`select-sort-direction-${name}`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="asc">{t("documents.asc", "По возрастанию")}</SelectItem><SelectItem value="desc">{t("documents.desc", "По убыванию")}</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-2 rounded-lg border border-slate-100 p-3">
            <div className="flex items-center justify-between"><Label>{t("documents.filters", "Фильтры")}</Label><Button type="button" variant="outline" size="sm" disabled={config.filters.length >= 12} onClick={() => patch({ filters: [...config.filters, { fieldKey: linkedFields[0]?.fieldKey ?? "__status__", operator: "eq", value: "" }] })}><Plus className="me-1 h-3.5 w-3.5" />{t("documents.addFilter", "Добавить фильтр")}</Button></div>
            {config.filters.map((filter, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)_auto]">
                <Select value={filter.fieldKey} onValueChange={(fieldKey) => patch({ filters: config.filters.map((item, i) => i === index ? { ...item, fieldKey } : item) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__status__">{t("documents.recordStatus", "Статус записи")}</SelectItem>{linkedFields.map((field) => <SelectItem key={field.fieldKey} value={field.fieldKey}>{ml(field.nameJson) || field.fieldKey}</SelectItem>)}</SelectContent></Select>
                <Select value={filter.operator} onValueChange={(operator) => patch({ filters: config.filters.map((item, i) => i === index ? { ...item, operator: operator as CollectionFilter["operator"] } : item) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(["eq", "neq", "contains", "empty", "notEmpty"] as const).map((operator) => <SelectItem key={operator} value={operator}>{t(`documents.operator.${operator}`, ({ eq: "Равно", neq: "Не равно", contains: "Содержит", empty: "Пусто", notEmpty: "Не пусто" } as const)[operator])}</SelectItem>)}</SelectContent></Select>
                {filter.operator !== "empty" && filter.operator !== "notEmpty" ? <Input value={filter.value == null ? "" : String(filter.value)} onChange={(event) => patch({ filters: config.filters.map((item, i) => i === index ? { ...item, value: event.target.value } : item) })} /> : <div />}
                <Button type="button" variant="ghost" size="icon" onClick={() => patch({ filters: config.filters.filter((_, i) => i !== index) })}><X className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
          <div className="space-y-3">{tags.map((tag) => (
            <div key={tag} className="grid gap-2 lg:grid-cols-[180px_minmax(0,1fr)]">
              <code className="rounded bg-slate-100 px-2 py-2 text-xs text-slate-700" data-testid={`tag-${name}-${tag}`}>{tag}</code>
              <ValueMappingEditor value={config.fields[tag]} fields={linkedFields} onChange={(mapped) => patch({ fields: { ...config.fields, [tag]: mapped } })} t={t} ml={ml} />
            </div>
          ))}</div>
        </>
      )}
    </div>
  );
}

export default function DocumentsPage(): ReactElement {
  const t = useT();
  const ml = useML();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: modules = [], isLoading: modulesLoading } = useListModules();
  const module = modules.find((item) => item.moduleKey === "document_generation");
  const { data: entitiesRaw = [] } = useListEntities();
  const entities = [...entitiesRaw].filter((e) => e.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const [entityId, setEntityId] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<DocumentTemplate | null>(null);
  const [revision, setRevision] = useState<DocumentTemplateRevision | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Mapping>(emptyMapping);
  const [output, setOutput] = useState<Output>(defaultOutput);
  const [testRecordId, setTestRecordId] = useState("");
  const [historyStatus, setHistoryStatus] = useState<"" | "running" | "success" | "error">("");
  const [orphanRecovery, setOrphanRecovery] = useState<OrphanRecoveryRequest | null>(null);

  useEffect(() => {
    if (!entityId && entities.length) setEntityId(entities[0].id);
  }, [entities, entityId]);
  const { data: templates = [], isLoading } = useListDocumentTemplates(
    { entityId },
    { query: { enabled: entityId > 0, queryKey: getListDocumentTemplatesQueryKey({ entityId }) } },
  );
  const { data: fieldsRaw = [] } = useListEntityFields(entityId, {
    query: { enabled: entityId > 0, queryKey: getListEntityFieldsQueryKey(entityId) },
  });
  const { data: records = [] } = useListEntityRecords(entityId);
  const { data: driveFolders = [] } = useListGoogleDriveFolders({
    query: { retry: false, queryKey: getListGoogleDriveFoldersQueryKey() },
  });
  const { data: localFolders = [] } = useListLocalFolders({
    query: { queryKey: getListLocalFoldersQueryKey() },
  });
  const historyParams = selected ? { templateId: selected.id, limit: 50, ...(historyStatus ? { status: historyStatus } : {}) } : undefined;
  const history = useListDocumentGenerationRuns(historyParams, {
    query: { enabled: !!selected, queryKey: getListDocumentGenerationRunsQueryKey(historyParams) },
  });
  const fields = [...fieldsRaw].filter((f) => f.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const relationFields = fields.filter((f) => f.fieldType === "relation" || f.fieldType === "lookup");
  const fileFields = fields.filter((f) => f.fieldType === "file");
  const manifest = asObject(revision?.manifestJson) as Manifest;
  const scalarTags = Array.isArray(manifest.scalars) ? manifest.scalars : [];
  const collections = manifest.collections && typeof manifest.collections === "object" ? manifest.collections : {};
  const parserErrors = Array.isArray(manifest.errors) ? manifest.errors : [];
  const visibleTemplates = templates.filter((item) => showArchived || !item.isArchived);
  const complete = scalarTags.every((tag) => sourceComplete(mapping.scalars[tag])) &&
    Object.entries(collections).every(([collection, tags]) => {
      const config = mapping.collections[collection];
      return !!config?.relationFieldKey && tags.every((tag) => sourceComplete(config.fields[tag]));
    }) && parserErrors.length === 0;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/document-templates"] });
  const create = useCreateDocumentTemplate({
    mutation: {
      onSuccess: (created) => { setCreateOpen(false); setName(""); setSelected(created); invalidate(); },
      onError: (e) => toast({ title: t("documents.createError", "Не удалось создать шаблон"), description: localizeDocumentError(e, t), variant: "destructive" }),
    },
  });
  const update = useUpdateDocumentTemplate({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e) => toast({ title: t("documents.updateError", "Не удалось обновить шаблон"), description: localizeDocumentError(e, t), variant: "destructive" }),
    },
  });
  const upload = useCreateDocumentTemplateRevision({
    mutation: {
      onSuccess: (created) => {
        setRevision(created);
        setMapping(asObject(created.mappingJson) as Mapping);
        invalidate();
        toast({ title: t("documents.draftSaved", "Черновик редакции сохранён") });
      },
      onError: (e) => toast({ title: t("documents.uploadError", "Не удалось загрузить DOCX"), description: localizeDocumentError(e, t), variant: "destructive" }),
    },
  });
  const publish = usePublishDocumentTemplateRevision({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: t("documents.published", "Редакция опубликована") }); },
      onError: (e) => toast({ title: t("documents.publishError", "Не удалось опубликовать"), description: localizeDocumentError(e, t), variant: "destructive" }),
    },
  });
  const test = useTestDocumentTemplateRevision({
    mutation: {
      onSuccess: (blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = testDownloadName(selected?.name ?? revision?.templateName ?? "document", output.outputFormat);
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        toast({ title: t("documents.testReady", "Тестовый документ скачан") });
      },
      onError: (e) => toast({ title: t("documents.testError", "Не удалось создать тестовый документ"), description: localizeDocumentError(e, t), variant: "destructive" }),
    },
  });
  const resolveOrphan = useResolveDocumentGenerationOrphan({
    mutation: {
      onSuccess: (result) => {
        setOrphanRecovery(null);
        queryClient.invalidateQueries({ queryKey: getListDocumentGenerationRunsQueryKey(historyParams) });
        history.refetch();
        const outcomeKey = result.outcome === "attached" ? "documents.orphanOutcomeAttached" : result.outcome === "deleted" ? "documents.orphanOutcomeDeleted" : "documents.orphanOutcomeAcknowledged";
        const outcomeFallback = result.outcome === "attached" ? "Результат прикреплён к записи" : result.outcome === "deleted" ? "Результат перемещён в корзину Google Drive" : "Потерянный результат отмечен как обработанный";
        toast({ title: t(outcomeKey, outcomeFallback) });
      },
      onError: (error) => toast({ title: t("documents.orphanRecoveryError", "Не удалось обработать потерянный результат"), description: localizeDocumentError(error, t), variant: "destructive" }),
    },
  });

  const openTemplate = (template: DocumentTemplate) => {
    setSelected(template);
    const latest = template.revisions[0] ?? null;
    setRevision(latest);
    setFile(null);
    setMapping(latest ? asObject(latest.mappingJson) as Mapping : emptyMapping());
    setOutput(defaultOutput());
    setTestRecordId("");
  };
  const saveDraft = () => {
    if (!selected || !file) return;
    upload.mutate({
      id: selected.id,
      data: { file, mapping: JSON.stringify(mapping) },
    });
  };

  if (modulesLoading) return <div className="p-6 space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>;
  if (selected) {
    return (
      <div className="p-4 md:p-6 space-y-5" data-testid="documents-workspace">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelected(null)} data-testid="button-documents-back"><ArrowLeft className="h-4 w-4 rtl:rotate-180" /></Button>
          <div className="min-w-0 flex-1"><h1 className="truncate text-2xl font-bold text-slate-800">{selected.name}</h1><p className="text-sm text-slate-500">{entities.find((e) => e.id === selected.entityId) ? ml(entities.find((e) => e.id === selected.entityId)!.nameJson) : ""}</p></div>
          {revision && <Badge className={revision.state === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>{revision.state === "published" ? t("documents.revisionState.published", "Опубликовано") : revision.state === "draft" ? t("documents.revisionState.draft", "Черновик") : t("documents.revisionState.unknown", "Неизвестное состояние")} · v{revision.revision}</Badge>}
        </div>
          {!module?.isEnabled && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("documents.moduleDisabledReadOnly", "Создание документов отключено. История доступна, но изменение и создание документов запрещены.")}</p>}

        <Card><CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2"><Upload className="h-5 w-5 text-blue-600" /><h2 className="font-semibold">{t("documents.sourceDocx", "Исходный файл DOCX")}</h2></div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-docx-revision" />
              <Button onClick={saveDraft} disabled={!module?.isEnabled || !file || upload.isPending} data-testid="button-save-draft"><Save className="me-2 h-4 w-4" />{revision ? t("documents.saveNewRevision", "Сохранить новую черновую редакцию") : t("documents.uploadAnalyze", "Загрузить и проанализировать")}</Button>
          </div>
          <p className="text-xs text-slate-500">{file?.name ?? revision?.templateName ?? t("documents.noFile", "Выберите файл .docx. Теги будут найдены после загрузки.")}</p>
        </CardContent></Card>

        {revision && (
          <>
            {(parserErrors.length > 0 || revision.errorsJson.length > 0) && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4" data-testid="status-template-errors">
                <p className="font-medium text-red-800">{t("documents.validationErrors", "Ошибки проверки шаблона")}</p>
                <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-red-700">{[...new Set([...parserErrors, ...revision.errorsJson])].map((error) => <li key={error}>{localizeDocumentError(error, t)}</li>)}</ul>
              </div>
            )}
            <Card><CardContent className="p-5 space-y-4">
              <div><h2 className="font-semibold">{t("documents.scalarTags", "Скалярные теги")}</h2><p className="text-sm text-slate-500">{t("documents.mapEveryTag", "Сопоставьте каждый найденный тег или явно отметьте его пустым.")}</p></div>
              {scalarTags.length === 0 ? <p className="text-sm text-slate-400">{t("documents.noScalarTags", "Скалярные теги не найдены")}</p> : scalarTags.map((tag) => (
                <div key={tag} className="grid gap-2 rounded-lg border border-slate-100 p-3 lg:grid-cols-[200px_minmax(0,1fr)]">
                  <code className="rounded bg-slate-100 px-2 py-2 text-xs" data-testid={`tag-scalar-${tag}`}>{tag}</code>
                  <ValueMappingEditor value={mapping.scalars[tag]} fields={fields} onChange={(value) => setMapping((m) => ({ ...m, scalars: { ...m.scalars, [tag]: value } }))} t={t} ml={ml} />
                </div>
              ))}
            </CardContent></Card>
            <Card><CardContent className="p-5 space-y-4">
              <div><h2 className="font-semibold">{t("documents.collections", "Коллекции")}</h2><p className="text-sm text-slate-500">{t("documents.collectionsHint", "Повторяйте блок DOCX для записей, связанных через отношение.")}</p></div>
              {Object.keys(collections).length === 0 ? <p className="text-sm text-slate-400">{t("documents.noCollections", "Теги коллекций не найдены")}</p> : Object.entries(collections).map(([collection, tags]) => (
                <CollectionEditor key={collection} name={collection} tags={tags} value={mapping.collections[collection]} relationFields={relationFields} currentEntityId={entityId} onChange={(value) => setMapping((m) => ({ ...m, collections: { ...m.collections, [collection]: value } }))} t={t} ml={ml} />
              ))}
            </CardContent></Card>
            <Card><CardContent className="p-5 space-y-4">
              <h2 className="font-semibold">{t("documents.output", "Настройки тестового результата")}</h2>
              <p className="text-sm text-slate-500">{t("documents.testDownloadHint", "Тестовый файл скачивается напрямую в браузер, не сохраняется и не записывается в запись.")}</p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5"><Label>{t("documents.format", "Формат")}</Label><Select value={output.outputFormat} onValueChange={(outputFormat) => setOutput({ ...output, outputFormat: outputFormat as Output["outputFormat"] })}><SelectTrigger data-testid="select-output-format"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="docx">DOCX</SelectItem><SelectItem value="pdf">PDF</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5"><Label>{t("documents.destination", "Назначение")}</Label><Select value={output.destination} onValueChange={(destination) => setOutput({ ...output, destination: destination as Output["destination"], localFolderId: undefined, driveFolderId: undefined })}><SelectTrigger data-testid="select-output-destination"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="local">{t("documents.localStorage", "Управляемое локальное хранилище")}</SelectItem><SelectItem value="gdrive">Google Drive</SelectItem></SelectContent></Select></div>
                {output.destination === "local" ? <div className="space-y-1.5"><Label>{t("documents.localFolder", "Управляемая локальная папка")}</Label><Select value={output.localFolderId ? String(output.localFolderId) : ""} onValueChange={(value) => setOutput({ ...output, localFolderId: Number(value) })}><SelectTrigger><SelectValue placeholder={t("documents.chooseFolder", "Выберите папку")} /></SelectTrigger><SelectContent>{localFolders.map((folder) => <SelectItem key={folder.id} value={String(folder.id)}>{folder.name}</SelectItem>)}</SelectContent></Select></div> : <div className="space-y-1.5"><Label>{t("documents.driveFolder", "Управляемая папка Google Drive")}</Label><Select value={output.driveFolderId ?? ""} onValueChange={(driveFolderId) => setOutput({ ...output, driveFolderId })}><SelectTrigger data-testid="select-drive-folder"><SelectValue placeholder={t("documents.chooseFolder", "Выберите папку")} /></SelectTrigger><SelectContent>{driveFolders.map((folder) => <SelectItem key={folder.driveFolderId} value={folder.driveFolderId}>{folder.name}</SelectItem>)}</SelectContent></Select></div>}
                <div className="space-y-1.5"><Label>{t("documents.fileField", "Записать результат в файловое поле")}</Label><Select value={output.targetFileFieldKey} onValueChange={(targetFileFieldKey) => setOutput({ ...output, targetFileFieldKey })}><SelectTrigger data-testid="select-target-file-field"><SelectValue placeholder={t("documents.chooseField", "Выберите поле")} /></SelectTrigger><SelectContent>{fileFields.map((field) => <SelectItem key={field.fieldKey} value={field.fieldKey}>{ml(field.nameJson) || field.fieldKey}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label>{t("documents.overwrite", "Если в целевом поле уже есть файл")}</Label><Select value={output.overwrite} onValueChange={(overwrite) => setOutput({ ...output, overwrite: overwrite as Output["overwrite"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="replace">{t("documents.replace", "Заменить существующий файл")}</SelectItem><SelectItem value="error">{t("documents.failIfExists", "Завершить с ошибкой без замены")}</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5 md:col-span-2"><Label>{t("documents.fileName", "Шаблон имени файла")}</Label><Input value={output.filenameTemplate} maxLength={180} onChange={(e) => setOutput({ ...output, filenameTemplate: e.target.value })} data-testid="input-output-filename" /></div>
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-5 space-y-4">
              <h2 className="font-semibold">{t("documents.verifyPublish", "Тестирование и публикация")}</h2>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1 space-y-1.5"><Label>{t("documents.testRecord", "Тестовая запись")}</Label><Select value={testRecordId} onValueChange={setTestRecordId}><SelectTrigger data-testid="select-test-record"><SelectValue placeholder={t("documents.chooseRecord", "Выберите запись")} /></SelectTrigger><SelectContent>{records.map((record) => <SelectItem key={record.id} value={String(record.id)}>#{record.id} · {Object.values(record.valuesJson).filter((v) => typeof v === "string" || typeof v === "number").slice(0, 2).join(" · ")}</SelectItem>)}</SelectContent></Select></div>
                <Button variant="outline" disabled={!module?.isEnabled || !testRecordId || !output.targetFileFieldKey || !output.filenameTemplate || (output.destination === "local" ? !output.localFolderId : !output.driveFolderId) || test.isPending} onClick={() => test.mutate({ id: revision.id, data: { recordId: Number(testRecordId), output: output.destination === "local" ? { outputFormat: output.outputFormat, destination: "local", localFolderId: output.localFolderId!, targetFileFieldKey: output.targetFileFieldKey, filenameTemplate: output.filenameTemplate, overwrite: output.overwrite } : { outputFormat: output.outputFormat, destination: "gdrive", driveFolderId: output.driveFolderId!, targetFileFieldKey: output.targetFileFieldKey, filenameTemplate: output.filenameTemplate, overwrite: output.overwrite } } })} data-testid="button-test-document"><Download className="me-2 h-4 w-4" />{t("documents.generateTest", "Создать тестовый документ")}</Button>
                <Button disabled={!module?.isEnabled || !complete || publish.isPending || revision.state !== "draft"} onClick={() => publish.mutate({ id: revision.id })} data-testid="button-publish-revision"><Send className="me-2 h-4 w-4" />{t("documents.publish", "Опубликовать")}</Button>
              </div>
              {!complete && <p className="flex items-center gap-2 text-xs text-amber-700"><AlertCircle className="h-4 w-4" />{t("documents.publishIncomplete", "Публикация станет доступна после сопоставления всех тегов, устранения ошибок разбора и сохранения настроенного DOCX как корректного черновика.")}</p>}
            </CardContent></Card>
          </>
        )}
        <Card><CardContent className="p-5 space-y-4" data-testid="document-generation-history">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{t("documents.history", "История создания")}</h2><p className="text-sm text-slate-500">{t("documents.historyHint", "Последние 50 запусков для этого шаблона")}</p></div><div className="flex gap-2"><Select value={historyStatus || "__all"} onValueChange={(value) => setHistoryStatus(value === "__all" ? "" : value as typeof historyStatus)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all">{t("documents.allStatuses", "Все статусы")}</SelectItem><SelectItem value="running">{t("documents.runStatus.running", "Выполняется")}</SelectItem><SelectItem value="success">{t("documents.runStatus.success", "Успешно")}</SelectItem><SelectItem value="error">{t("documents.runStatus.error", "Ошибка")}</SelectItem></SelectContent></Select><Button variant="outline" size="icon" onClick={() => history.refetch()} disabled={history.isFetching} aria-label={t("documents.refreshHistory", "Обновить историю")}><RefreshCw className={`h-4 w-4 ${history.isFetching ? "animate-spin" : ""}`} /></Button></div></div>
          {history.isLoading ? <div className="space-y-2">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}</div> : history.isError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{t("documents.historyError", "Не удалось загрузить историю создания")}: {localizeDocumentError(history.error, t)}</p> : history.data?.items.length === 0 ? <p className="py-5 text-center text-sm text-slate-500">{t("documents.historyEmpty", "Запусков создания документов пока нет")}</p> : <div className="space-y-3">{[...(history.data?.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((run) => {
            const output = run.output;
            const resolution = output?.orphanResolution;
            const isActiveOrphan = output?.orphaned && !resolution;
            const url = output?.path ? objectServingUrl(output.path) : output?.fileId ? gdriveContentUrl(output.fileId) : output?.webViewLink;
            const canOpenOutput = !output?.orphaned || resolution?.outcome === "attached";
            const badge = run.status === "success" ? "bg-emerald-100 text-emerald-700" : run.status === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
            const resolutionOutcome = resolution?.outcome === "attached" ? t("documents.orphanOutcomeAttached", "Прикреплён к записи") : resolution?.outcome === "deleted" ? t("documents.orphanOutcomeDeleted", "Перемещён в корзину Google Drive") : t("documents.orphanOutcomeAcknowledged", "Отмечен как обработанный");
            const runStatus = run.status === "running" ? t("documents.runStatus.running", "Выполняется") : run.status === "success" ? t("documents.runStatus.success", "Успешно") : run.status === "error" ? t("documents.runStatus.error", "Ошибка") : t("documents.runStatus.unknown", "Неизвестный статус");
            return <div key={run.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Badge className={badge}>{runStatus}</Badge><span className="font-medium">v{run.revision}</span><span className="text-slate-600">{t("documents.record", "Запись")} #{run.recordId}</span>{run.actorUserId != null && <span className="text-slate-500">{t("documents.actor", "Пользователь")} #{run.actorUserId}</span>}<span className="ms-auto text-xs text-slate-500">{new Date(run.createdAt).toLocaleString()}</span></div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">{run.completedAt && <span>{t("documents.completed", "Завершено")}: {new Date(run.completedAt).toLocaleString()}</span>}{output?.name && <span>{output.name}</span>}{output?.contentType && <span>{output.contentType}</span>}{output?.size != null && <span>{readableSize(output.size)}</span>}{output?.destination && <span>{output.destination === "gdrive" ? "Google Drive" : t("documents.localStorage", "Управляемое локальное хранилище")}</span>}{url && canOpenOutput && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline"><ExternalLink className="h-3.5 w-3.5" />{t("documents.openOutput", "Открыть результат")}</a>}</div>
              {isActiveOrphan && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{t("documents.orphanWarning", "Результат не прикреплён к записи")}{output?.cleanup?.attempted ? ` · ${output.cleanup.deleted ? t("documents.cleanupDeleted", "очистка удалила его") : t("documents.cleanupAttempted", "выполнена попытка очистки")}` : ""}{output?.cleanup?.error ? ` · ${localizeDocumentError(output.cleanup.error, t)}` : ""}</p>}
              {isActiveOrphan && output?.recoveryAvailable && <div className="mt-3 flex flex-wrap gap-2" data-testid={`orphan-recovery-actions-${run.id}`}>
                <Button size="sm" variant="outline" disabled={!module?.isEnabled || resolveOrphan.isPending} onClick={() => setOrphanRecovery({ runId: run.id, action: "retry_writeback" })} data-testid={`button-orphan-retry-${run.id}`}><RotateCcw className="me-1.5 h-4 w-4" />{t("documents.orphanRetry", "Повторить запись в поле")}</Button>
                <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800" disabled={!module?.isEnabled || resolveOrphan.isPending} onClick={() => setOrphanRecovery({ runId: run.id, action: "delete_output" })} data-testid={`button-orphan-delete-${run.id}`}><Trash2 className="me-1.5 h-4 w-4" />{t("documents.orphanTrash", "Переместить в корзину Drive")}</Button>
                <Button size="sm" variant="outline" disabled={!module?.isEnabled || resolveOrphan.isPending} onClick={() => setOrphanRecovery({ runId: run.id, action: "mark_resolved" })} data-testid={`button-orphan-resolve-${run.id}`}><CircleCheck className="me-1.5 h-4 w-4" />{t("documents.orphanMarkResolved", "Отметить как обработанный")}</Button>
              </div>}
              {isActiveOrphan && !output?.recoveryAvailable && <div className="mt-2 rounded bg-slate-50 px-2 py-2 text-xs text-slate-700" data-testid={`status-orphan-recovery-unavailable-${run.id}`}>{t("documents.orphanRecoveryUnavailable", "Автоматическое восстановление недоступно для этого устаревшего или уже очищенного результата.")}</div>}
              {resolution && <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800" data-testid={`status-orphan-resolution-${run.id}`}><div className="flex items-center gap-1.5 font-medium"><CircleCheck className="h-4 w-4" />{t("documents.orphanResolved", "Потерянный результат обработан")}: {resolutionOutcome}</div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1"><span>{t("documents.orphanResolutionAction", "Действие")}: {resolution.action === "retry_writeback" ? t("documents.orphanAction.retry_writeback", "Повторная запись в поле") : resolution.action === "delete_output" ? t("documents.orphanAction.delete_output", "Перемещение в корзину") : resolution.action === "mark_resolved" ? t("documents.orphanAction.mark_resolved", "Отметка как обработанного") : t("documents.orphanAction.unknown", "Неизвестное действие")}</span><span>{t("documents.orphanResolutionActor", "ID пользователя")}: #{resolution.actorUserId}</span><span>{t("documents.orphanResolutionTime", "Обработано")}: {new Date(resolution.resolvedAt).toLocaleString()}</span></div></div>}
              {run.error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{localizeDocumentError(run.error, t)}</p>}
            </div>;
          })}</div>}
        </CardContent></Card>
        <AlertDialog open={!!orphanRecovery} onOpenChange={(open) => { if (!open && !resolveOrphan.isPending) setOrphanRecovery(null); }}>
          <AlertDialogContent data-testid="dialog-orphan-recovery">
            <AlertDialogHeader>
              <AlertDialogTitle>{orphanRecovery?.action === "retry_writeback" ? t("documents.orphanRetryConfirmTitle", "Повторить запись в поле?") : orphanRecovery?.action === "delete_output" ? t("documents.orphanTrashConfirmTitle", "Переместить файл в корзину Drive?") : t("documents.orphanResolveConfirmTitle", "Отметить результат как обработанный?")}</AlertDialogTitle>
              <AlertDialogDescription>{orphanRecovery?.action === "retry_writeback" ? t("documents.orphanRetryConfirmDescription", "Созданный файл будет записан в настроенное поле записи и может заменить текущий файл согласно исходным правилам запуска.") : orphanRecovery?.action === "delete_output" ? t("documents.orphanTrashConfirmDescription", "Неприкреплённый файл будет перемещён в корзину Google Drive, но не удалён безвозвратно.") : t("documents.orphanResolveConfirmDescription", "Несвязанный файл останется на Google Drive, а предложения о восстановлении больше не будут показываться.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={resolveOrphan.isPending}>{t("common.cancel", "Отмена")}</AlertDialogCancel>
              <AlertDialogAction className={orphanRecovery?.action === "delete_output" ? "bg-red-600 text-white hover:bg-red-700" : undefined} disabled={resolveOrphan.isPending || !module?.isEnabled || !orphanRecovery} onClick={() => orphanRecovery && resolveOrphan.mutate({ id: orphanRecovery.runId, data: { action: orphanRecovery.action } })} data-testid="button-confirm-orphan-recovery">{t("documents.orphanConfirm", "Подтвердить действие")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="documents-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-slate-800">{t("documents.title", "Документы")}</h1><p className="mt-1 text-sm text-slate-500">{t("documents.subtitle", "Версионные шаблоны DOCX и надёжное создание документов по записям")}</p></div>
         <Button onClick={() => setCreateOpen(true)} disabled={!module?.isEnabled || !entityId} data-testid="button-create-template"><Plus className="me-2 h-4 w-4" />{t("documents.newTemplate", "Новый шаблон")}</Button>
      </div>
       {!module?.isEnabled && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("documents.moduleDisabledReadOnly", "Создание документов отключено. История доступна, но изменение и создание документов запрещены.")}</p>}
       <div className="flex flex-wrap items-center gap-4">
        <Select value={entityId ? String(entityId) : ""} onValueChange={(value) => setEntityId(Number(value))}><SelectTrigger className="w-72" data-testid="select-template-entity"><SelectValue placeholder={t("documents.chooseEntity", "Выберите сущность")} /></SelectTrigger><SelectContent>{entities.map((entity: Entity) => <SelectItem key={entity.id} value={String(entity.id)}>{ml(entity.nameJson) || entity.entityKey}</SelectItem>)}</SelectContent></Select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600"><Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} data-testid="checkbox-show-archived" />{t("documents.showArchived", "Показывать архивные")}</label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />) : visibleTemplates.length === 0 ? (
          <Card className="lg:col-span-2 border-dashed"><CardContent className="py-14 text-center"><FileText className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p className="font-medium text-slate-600">{t("documents.empty", "Для этой сущности нет шаблонов")}</p><p className="text-sm text-slate-400">{t("documents.emptyHint", "Создайте шаблон, затем загрузите DOCX с тегами.")}</p></CardContent></Card>
        ) : visibleTemplates.map((template) => {
          const latest = template.revisions[0];
          const publishedRevision = template.revisions.find((r) => r.state === "published");
          return (
            <Card key={template.id} className="transition-shadow hover:shadow-md" data-testid={`card-template-${template.id}`}><CardContent className="p-5 space-y-4">
              <div className="flex items-start gap-3"><div className="rounded-lg bg-blue-50 p-2 text-blue-600"><FileText className="h-5 w-5" /></div><div className="min-w-0 flex-1"><button className="truncate text-start font-semibold text-slate-800 hover:text-blue-700" onClick={() => openTemplate(template)} data-testid={`button-open-template-${template.id}`}>{template.name}</button><p className="text-xs text-slate-500">{template.revisions.length} {t("documents.revisions", "редакций")}</p></div>{template.isArchived && <Badge variant="secondary">{t("documents.archived", "В архиве")}</Badge>}</div>
              <div className="flex flex-wrap gap-2">{latest ? <Badge variant="outline">v{latest.revision} · {latest.state === "published" ? t("documents.revisionState.published", "Опубликовано") : latest.state === "draft" ? t("documents.revisionState.draft", "Черновик") : t("documents.revisionState.unknown", "Неизвестное состояние")}</Badge> : <Badge variant="outline">{t("documents.noRevisions", "Нет редакций")}</Badge>}{publishedRevision && <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 className="me-1 h-3 w-3" />{t("documents.readyAutomation", "Готово к автоматизации")}</Badge>}</div>
               <div className="flex justify-between"><Button variant="ghost" size="sm" disabled={!module?.isEnabled} onClick={() => update.mutate({ id: template.id, data: { isArchived: !template.isArchived } })} data-testid={`button-archive-template-${template.id}`}><Archive className="me-2 h-4 w-4" />{template.isArchived ? t("documents.restore", "Восстановить") : t("documents.archive", "Архивировать")}</Button><Button size="sm" onClick={() => openTemplate(template)} data-testid={`button-manage-template-${template.id}`}>{t("documents.manage", "Управление")}</Button></div>
            </CardContent></Card>
          );
        })}
      </div>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>{t("documents.createTitle", "Создать шаблон документа")}</DialogTitle><DialogDescription>{t("documents.createDesc", "Шаблон привязан к выбранной сущности.")}</DialogDescription></DialogHeader><div className="space-y-2"><Label>{t("documents.templateName", "Название шаблона")}</Label><Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="input-template-name" /></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>{t("common.cancel", "Отмена")}</Button><Button disabled={!module?.isEnabled || !name.trim() || create.isPending} onClick={() => create.mutate({ data: { entityId, name: name.trim() } })} data-testid="button-confirm-create-template">{t("common.create", "Создать")}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}