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
  useTestDocumentTemplateRevision,
  useUpdateDocumentTemplate,
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
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Plus,
  Save,
  RefreshCw,
  Send,
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
        <SelectTrigger data-testid="select-mapping-source"><SelectValue placeholder={t("documents.chooseSource", "Choose source")} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="field">{t("documents.source.field", "Entity field / formula")}</SelectItem>
          <SelectItem value="status">{t("documents.source.status", "Record status")}</SelectItem>
          <SelectItem value="system">{t("documents.source.system", "System value")}</SelectItem>
          <SelectItem value="literal">{t("documents.source.literal", "Fixed text")}</SelectItem>
          <SelectItem value="blank">{t("documents.source.blank", "Intentionally blank")}</SelectItem>
        </SelectContent>
      </Select>
      {value?.source === "field" && (
        <Select value={value.fieldKey} onValueChange={(fieldKey) => onChange({ source: "field", fieldKey })}>
          <SelectTrigger data-testid="select-mapping-field"><SelectValue placeholder={t("documents.chooseField", "Choose field")} /></SelectTrigger>
          <SelectContent>{fields.map((f) => (
            <SelectItem key={f.fieldKey} value={f.fieldKey}>
              {ml(f.nameJson) || f.fieldKey}{f.fieldType === "function" ? ` · ${t("documents.formula", "formula")}` : ""}
            </SelectItem>
          ))}</SelectContent>
        </Select>
      )}
      {value?.source === "system" && (
        <Select value={value.key} onValueChange={(key) => onChange({ source: "system", key: key as "record_id" | "generated_at" })}>
          <SelectTrigger data-testid="select-system-value"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="record_id">{t("documents.system.recordId", "Record ID")}</SelectItem>
            <SelectItem value="generated_at">{t("documents.system.generatedAt", "Generation date/time")}</SelectItem>
          </SelectContent>
        </Select>
      )}
      {value?.source === "literal" && (
        <Input data-testid="input-literal-value" value={value.value} onChange={(e) => onChange({ source: "literal", value: e.target.value })} />
      )}
      {value?.source === "blank" && <p className="self-center text-xs text-slate-500">{t("documents.blankHint", "This tag is deliberately rendered empty.")}</p>}
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
        <div><p className="font-semibold text-slate-800">{name}</p><p className="text-xs text-slate-500">{tags.length} {t("documents.childTags", "child tags")}</p></div>
        <Select value={config.relationFieldKey} onValueChange={(relationFieldKey) => onChange({ relationFieldKey, filters: [], sort: [], fields: {} })}>
          <SelectTrigger className="w-64" data-testid={`select-relation-${name}`}><SelectValue placeholder={t("documents.chooseRelation", "Choose relation")} /></SelectTrigger>
          <SelectContent>{relationFields.map((f) => <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {config.relationFieldKey && (
        <>
          <div className="grid gap-2 sm:grid-cols-[110px_minmax(0,1fr)_130px] items-center">
            <Label>{t("documents.sort", "Sort")}</Label>
            <Select value={firstSort?.fieldKey ?? "__none"} onValueChange={(fieldKey) => patch({ sort: fieldKey === "__none" ? [] : [{ fieldKey, direction: firstSort?.direction ?? "asc" }] })}>
              <SelectTrigger data-testid={`select-sort-${name}`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__none">{t("documents.noSort", "Source order")}</SelectItem>{linkedFields.map((field) => <SelectItem key={field.fieldKey} value={field.fieldKey}>{ml(field.nameJson) || field.fieldKey}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={firstSort?.direction ?? "asc"} disabled={!firstSort} onValueChange={(direction) => firstSort && patch({ sort: [{ ...firstSort, direction: direction as "asc" | "desc" }] })}>
              <SelectTrigger data-testid={`select-sort-direction-${name}`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="asc">{t("documents.asc", "Ascending")}</SelectItem><SelectItem value="desc">{t("documents.desc", "Descending")}</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-2 rounded-lg border border-slate-100 p-3">
            <div className="flex items-center justify-between"><Label>{t("documents.filters", "Filters")}</Label><Button type="button" variant="outline" size="sm" disabled={config.filters.length >= 12} onClick={() => patch({ filters: [...config.filters, { fieldKey: linkedFields[0]?.fieldKey ?? "__status__", operator: "eq", value: "" }] })}><Plus className="me-1 h-3.5 w-3.5" />{t("documents.addFilter", "Add filter")}</Button></div>
            {config.filters.map((filter, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_minmax(0,1fr)_auto]">
                <Select value={filter.fieldKey} onValueChange={(fieldKey) => patch({ filters: config.filters.map((item, i) => i === index ? { ...item, fieldKey } : item) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__status__">{t("documents.recordStatus", "Record status")}</SelectItem>{linkedFields.map((field) => <SelectItem key={field.fieldKey} value={field.fieldKey}>{ml(field.nameJson) || field.fieldKey}</SelectItem>)}</SelectContent></Select>
                <Select value={filter.operator} onValueChange={(operator) => patch({ filters: config.filters.map((item, i) => i === index ? { ...item, operator: operator as CollectionFilter["operator"] } : item) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["eq", "neq", "contains", "empty", "notEmpty"].map((operator) => <SelectItem key={operator} value={operator}>{operator}</SelectItem>)}</SelectContent></Select>
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
      onError: (e) => toast({ title: t("documents.createError", "Could not create template"), description: extractError(e), variant: "destructive" }),
    },
  });
  const update = useUpdateDocumentTemplate({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (e) => toast({ title: t("documents.updateError", "Could not update template"), description: extractError(e), variant: "destructive" }),
    },
  });
  const upload = useCreateDocumentTemplateRevision({
    mutation: {
      onSuccess: (created) => {
        setRevision(created);
        setMapping(asObject(created.mappingJson) as Mapping);
        invalidate();
        toast({ title: t("documents.draftSaved", "Draft revision saved") });
      },
      onError: (e) => toast({ title: t("documents.uploadError", "Could not upload DOCX"), description: extractError(e), variant: "destructive" }),
    },
  });
  const publish = usePublishDocumentTemplateRevision({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: t("documents.published", "Revision published") }); },
      onError: (e) => toast({ title: t("documents.publishError", "Could not publish"), description: extractError(e), variant: "destructive" }),
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
        toast({ title: t("documents.testReady", "Test document downloaded") });
      },
      onError: (e) => toast({ title: t("documents.testError", "Test generation failed"), description: extractError(e), variant: "destructive" }),
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
          {revision && <Badge className={revision.state === "published" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>{revision.state === "published" ? t("documents.publishedStatus", "Published") : t("documents.draftStatus", "Draft")} · v{revision.revision}</Badge>}
        </div>
         {!module?.isEnabled && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("documents.moduleDisabledReadOnly", "Document generation is disabled. History remains available, but changes and generation are disabled.")}</p>}

        <Card><CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2"><Upload className="h-5 w-5 text-blue-600" /><h2 className="font-semibold">{t("documents.sourceDocx", "DOCX source")}</h2></div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-docx-revision" />
             <Button onClick={saveDraft} disabled={!module?.isEnabled || !file || upload.isPending} data-testid="button-save-draft"><Save className="me-2 h-4 w-4" />{revision ? t("documents.saveNewRevision", "Save new draft revision") : t("documents.uploadAnalyze", "Upload and analyze")}</Button>
          </div>
          <p className="text-xs text-slate-500">{file?.name ?? revision?.templateName ?? t("documents.noFile", "Choose a .docx file. Tags will be detected after upload.")}</p>
        </CardContent></Card>

        {revision && (
          <>
            {(parserErrors.length > 0 || revision.errorsJson.length > 0) && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4" data-testid="status-template-errors">
                <p className="font-medium text-red-800">{t("documents.validationErrors", "Template validation issues")}</p>
                <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-red-700">{[...new Set([...parserErrors, ...revision.errorsJson])].map((error) => <li key={error}>{error}</li>)}</ul>
              </div>
            )}
            <Card><CardContent className="p-5 space-y-4">
              <div><h2 className="font-semibold">{t("documents.scalarTags", "Scalar tags")}</h2><p className="text-sm text-slate-500">{t("documents.mapEveryTag", "Map every detected tag or explicitly mark it blank.")}</p></div>
              {scalarTags.length === 0 ? <p className="text-sm text-slate-400">{t("documents.noScalarTags", "No scalar tags detected")}</p> : scalarTags.map((tag) => (
                <div key={tag} className="grid gap-2 rounded-lg border border-slate-100 p-3 lg:grid-cols-[200px_minmax(0,1fr)]">
                  <code className="rounded bg-slate-100 px-2 py-2 text-xs" data-testid={`tag-scalar-${tag}`}>{tag}</code>
                  <ValueMappingEditor value={mapping.scalars[tag]} fields={fields} onChange={(value) => setMapping((m) => ({ ...m, scalars: { ...m.scalars, [tag]: value } }))} t={t} ml={ml} />
                </div>
              ))}
            </CardContent></Card>
            <Card><CardContent className="p-5 space-y-4">
              <div><h2 className="font-semibold">{t("documents.collections", "Collections")}</h2><p className="text-sm text-slate-500">{t("documents.collectionsHint", "Repeat a DOCX block for records linked through a relation.")}</p></div>
              {Object.keys(collections).length === 0 ? <p className="text-sm text-slate-400">{t("documents.noCollections", "No collection tags detected")}</p> : Object.entries(collections).map(([collection, tags]) => (
                <CollectionEditor key={collection} name={collection} tags={tags} value={mapping.collections[collection]} relationFields={relationFields} currentEntityId={entityId} onChange={(value) => setMapping((m) => ({ ...m, collections: { ...m.collections, [collection]: value } }))} t={t} ml={ml} />
              ))}
            </CardContent></Card>
            <Card><CardContent className="p-5 space-y-4">
              <h2 className="font-semibold">{t("documents.output", "Test output settings")}</h2>
              <p className="text-sm text-slate-500">{t("documents.testDownloadHint", "A test is downloaded directly to your browser. It is not saved or written back to the record.")}</p>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5"><Label>{t("documents.format", "Format")}</Label><Select value={output.outputFormat} onValueChange={(outputFormat) => setOutput({ ...output, outputFormat: outputFormat as Output["outputFormat"] })}><SelectTrigger data-testid="select-output-format"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="docx">DOCX</SelectItem><SelectItem value="pdf">PDF</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5"><Label>{t("documents.destination", "Destination")}</Label><Select value={output.destination} onValueChange={(destination) => setOutput({ ...output, destination: destination as Output["destination"], localFolderId: undefined, driveFolderId: undefined })}><SelectTrigger data-testid="select-output-destination"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="local">{t("documents.localStorage", "Local managed storage")}</SelectItem><SelectItem value="gdrive">Google Drive</SelectItem></SelectContent></Select></div>
                {output.destination === "local" ? <div className="space-y-1.5"><Label>{t("documents.localFolder", "Managed local folder")}</Label><Select value={output.localFolderId ? String(output.localFolderId) : ""} onValueChange={(value) => setOutput({ ...output, localFolderId: Number(value) })}><SelectTrigger><SelectValue placeholder={t("documents.chooseFolder", "Choose folder")} /></SelectTrigger><SelectContent>{localFolders.map((folder) => <SelectItem key={folder.id} value={String(folder.id)}>{folder.name}</SelectItem>)}</SelectContent></Select></div> : <div className="space-y-1.5"><Label>{t("documents.driveFolder", "Managed Drive folder")}</Label><Select value={output.driveFolderId ?? ""} onValueChange={(driveFolderId) => setOutput({ ...output, driveFolderId })}><SelectTrigger data-testid="select-drive-folder"><SelectValue placeholder={t("documents.chooseFolder", "Choose folder")} /></SelectTrigger><SelectContent>{driveFolders.map((folder) => <SelectItem key={folder.driveFolderId} value={folder.driveFolderId}>{folder.name}</SelectItem>)}</SelectContent></Select></div>}
                <div className="space-y-1.5"><Label>{t("documents.fileField", "Write result to file field")}</Label><Select value={output.targetFileFieldKey} onValueChange={(targetFileFieldKey) => setOutput({ ...output, targetFileFieldKey })}><SelectTrigger data-testid="select-target-file-field"><SelectValue placeholder={t("documents.chooseField", "Choose field")} /></SelectTrigger><SelectContent>{fileFields.map((field) => <SelectItem key={field.fieldKey} value={field.fieldKey}>{ml(field.nameJson) || field.fieldKey}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label>{t("documents.overwrite", "When target field already has a file")}</Label><Select value={output.overwrite} onValueChange={(overwrite) => setOutput({ ...output, overwrite: overwrite as Output["overwrite"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="replace">{t("documents.replace", "Replace existing file")}</SelectItem><SelectItem value="error">{t("documents.failIfExists", "Fail without replacing")}</SelectItem></SelectContent></Select></div>
                <div className="space-y-1.5 md:col-span-2"><Label>{t("documents.fileName", "File name template")}</Label><Input value={output.filenameTemplate} maxLength={180} onChange={(e) => setOutput({ ...output, filenameTemplate: e.target.value })} data-testid="input-output-filename" /></div>
              </div>
            </CardContent></Card>
            <Card><CardContent className="p-5 space-y-4">
              <h2 className="font-semibold">{t("documents.verifyPublish", "Test and publish")}</h2>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1 space-y-1.5"><Label>{t("documents.testRecord", "Test record")}</Label><Select value={testRecordId} onValueChange={setTestRecordId}><SelectTrigger data-testid="select-test-record"><SelectValue placeholder={t("documents.chooseRecord", "Choose record")} /></SelectTrigger><SelectContent>{records.map((record) => <SelectItem key={record.id} value={String(record.id)}>#{record.id} · {Object.values(record.valuesJson).filter((v) => typeof v === "string" || typeof v === "number").slice(0, 2).join(" · ")}</SelectItem>)}</SelectContent></Select></div>
                <Button variant="outline" disabled={!module?.isEnabled || !testRecordId || !output.targetFileFieldKey || !output.filenameTemplate || (output.destination === "local" ? !output.localFolderId : !output.driveFolderId) || test.isPending} onClick={() => test.mutate({ id: revision.id, data: { recordId: Number(testRecordId), output: output.destination === "local" ? { outputFormat: output.outputFormat, destination: "local", localFolderId: output.localFolderId!, targetFileFieldKey: output.targetFileFieldKey, filenameTemplate: output.filenameTemplate, overwrite: output.overwrite } : { outputFormat: output.outputFormat, destination: "gdrive", driveFolderId: output.driveFolderId!, targetFileFieldKey: output.targetFileFieldKey, filenameTemplate: output.filenameTemplate, overwrite: output.overwrite } } })} data-testid="button-test-document"><Download className="me-2 h-4 w-4" />{t("documents.generateTest", "Generate test")}</Button>
                <Button disabled={!module?.isEnabled || !complete || publish.isPending || revision.state !== "draft"} onClick={() => publish.mutate({ id: revision.id })} data-testid="button-publish-revision"><Send className="me-2 h-4 w-4" />{t("documents.publish", "Publish")}</Button>
              </div>
              {!complete && <p className="flex items-center gap-2 text-xs text-amber-700"><AlertCircle className="h-4 w-4" />{t("documents.publishIncomplete", "Publishing unlocks after every tag is mapped, parser errors are resolved, and the configured DOCX is saved as a clean draft.")}</p>}
            </CardContent></Card>
          </>
        )}
        <Card><CardContent className="p-5 space-y-4" data-testid="document-generation-history">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{t("documents.history", "Generation history")}</h2><p className="text-sm text-slate-500">{t("documents.historyHint", "Latest 50 generations for this template")}</p></div><div className="flex gap-2"><Select value={historyStatus || "__all"} onValueChange={(value) => setHistoryStatus(value === "__all" ? "" : value as typeof historyStatus)}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__all">{t("documents.allStatuses", "All statuses")}</SelectItem><SelectItem value="running">{t("documents.running", "Running")}</SelectItem><SelectItem value="success">{t("documents.success", "Success")}</SelectItem><SelectItem value="error">{t("documents.error", "Error")}</SelectItem></SelectContent></Select><Button variant="outline" size="icon" onClick={() => history.refetch()} disabled={history.isFetching} aria-label={t("documents.refreshHistory", "Refresh history")}><RefreshCw className={`h-4 w-4 ${history.isFetching ? "animate-spin" : ""}`} /></Button></div></div>
          {history.isLoading ? <div className="space-y-2">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}</div> : history.isError ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{t("documents.historyError", "Could not load generation history")}: {safeErrorText(extractError(history.error))}</p> : history.data?.items.length === 0 ? <p className="py-5 text-center text-sm text-slate-500">{t("documents.historyEmpty", "No document generations yet")}</p> : <div className="space-y-3">{[...(history.data?.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((run) => {
            const url = run.output?.path ? objectServingUrl(run.output.path) : run.output?.fileId ? gdriveContentUrl(run.output.fileId) : run.output?.webViewLink;
            const badge = run.status === "success" ? "bg-emerald-100 text-emerald-700" : run.status === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
            return <div key={run.id} className="rounded-lg border border-slate-200 p-3 text-sm"><div className="flex flex-wrap items-center gap-2"><Badge className={badge}>{t(`documents.${run.status}`, run.status)}</Badge><span className="font-medium">v{run.revision}</span><span className="text-slate-600">{t("documents.record", "Record")} #{run.recordId}</span>{run.actorUserId != null && <span className="text-slate-500">{t("documents.actor", "Actor")} #{run.actorUserId}</span>}<span className="ms-auto text-xs text-slate-500">{new Date(run.createdAt).toLocaleString()}</span></div><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">{run.completedAt && <span>{t("documents.completed", "Completed")}: {new Date(run.completedAt).toLocaleString()}</span>}{run.output?.name && <span>{run.output.name}</span>}{run.output?.contentType && <span>{run.output.contentType}</span>}{run.output?.size != null && <span>{readableSize(run.output.size)}</span>}{run.output?.destination && <span>{run.output.destination === "gdrive" ? "Google Drive" : t("documents.localStorage", "Local managed storage")}</span>}{url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline"><ExternalLink className="h-3.5 w-3.5" />{t("documents.openOutput", "Open output")}</a>}</div>{run.output?.orphaned && <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{t("documents.orphanWarning", "Output is orphaned")}{run.output.cleanup?.attempted ? ` · ${run.output.cleanup.deleted ? t("documents.cleanupDeleted", "cleanup deleted it") : t("documents.cleanupAttempted", "cleanup attempted")}` : ""}{run.output.cleanup?.error ? ` · ${safeErrorText(run.output.cleanup.error)}` : ""}</p>}{run.error && <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{safeErrorText(run.error)}</p>}</div>;
          })}</div>}
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6" data-testid="documents-page">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-slate-800">{t("documents.title", "Documents")}</h1><p className="mt-1 text-sm text-slate-500">{t("documents.subtitle", "Versioned DOCX templates and reliable record-based generation")}</p></div>
         <Button onClick={() => setCreateOpen(true)} disabled={!module?.isEnabled || !entityId} data-testid="button-create-template"><Plus className="me-2 h-4 w-4" />{t("documents.newTemplate", "New template")}</Button>
      </div>
       {!module?.isEnabled && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{t("documents.moduleDisabledReadOnly", "Document generation is disabled. History remains available, but changes and generation are disabled.")}</p>}
       <div className="flex flex-wrap items-center gap-4">
        <Select value={entityId ? String(entityId) : ""} onValueChange={(value) => setEntityId(Number(value))}><SelectTrigger className="w-72" data-testid="select-template-entity"><SelectValue placeholder={t("documents.chooseEntity", "Choose entity")} /></SelectTrigger><SelectContent>{entities.map((entity: Entity) => <SelectItem key={entity.id} value={String(entity.id)}>{ml(entity.nameJson) || entity.entityKey}</SelectItem>)}</SelectContent></Select>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600"><Checkbox checked={showArchived} onCheckedChange={(v) => setShowArchived(v === true)} data-testid="checkbox-show-archived" />{t("documents.showArchived", "Show archived")}</label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {isLoading ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-40" />) : visibleTemplates.length === 0 ? (
          <Card className="lg:col-span-2 border-dashed"><CardContent className="py-14 text-center"><FileText className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p className="font-medium text-slate-600">{t("documents.empty", "No templates for this entity")}</p><p className="text-sm text-slate-400">{t("documents.emptyHint", "Create a template, then upload a DOCX with tags.")}</p></CardContent></Card>
        ) : visibleTemplates.map((template) => {
          const latest = template.revisions[0];
          const publishedRevision = template.revisions.find((r) => r.state === "published");
          return (
            <Card key={template.id} className="transition-shadow hover:shadow-md" data-testid={`card-template-${template.id}`}><CardContent className="p-5 space-y-4">
              <div className="flex items-start gap-3"><div className="rounded-lg bg-blue-50 p-2 text-blue-600"><FileText className="h-5 w-5" /></div><div className="min-w-0 flex-1"><button className="truncate text-start font-semibold text-slate-800 hover:text-blue-700" onClick={() => openTemplate(template)} data-testid={`button-open-template-${template.id}`}>{template.name}</button><p className="text-xs text-slate-500">{template.revisions.length} {t("documents.revisions", "revisions")}</p></div>{template.isArchived && <Badge variant="secondary">{t("documents.archived", "Archived")}</Badge>}</div>
              <div className="flex flex-wrap gap-2">{latest ? <Badge variant="outline">v{latest.revision} · {latest.state}</Badge> : <Badge variant="outline">{t("documents.noRevisions", "No revisions")}</Badge>}{publishedRevision && <Badge className="bg-emerald-100 text-emerald-700"><CheckCircle2 className="me-1 h-3 w-3" />{t("documents.readyAutomation", "Ready for automation")}</Badge>}</div>
               <div className="flex justify-between"><Button variant="ghost" size="sm" disabled={!module?.isEnabled} onClick={() => update.mutate({ id: template.id, data: { isArchived: !template.isArchived } })} data-testid={`button-archive-template-${template.id}`}><Archive className="me-2 h-4 w-4" />{template.isArchived ? t("documents.restore", "Restore") : t("documents.archive", "Archive")}</Button><Button size="sm" onClick={() => openTemplate(template)} data-testid={`button-manage-template-${template.id}`}>{t("documents.manage", "Manage")}</Button></div>
            </CardContent></Card>
          );
        })}
      </div>
      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>{t("documents.createTitle", "Create document template")}</DialogTitle><DialogDescription>{t("documents.createDesc", "The template is tied to the currently selected entity.")}</DialogDescription></DialogHeader><div className="space-y-2"><Label>{t("documents.templateName", "Template name")}</Label><Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} data-testid="input-template-name" /></div><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>{t("common.cancel", "Cancel")}</Button><Button disabled={!module?.isEnabled || !name.trim() || create.isPending} onClick={() => create.mutate({ data: { entityId, name: name.trim() } })} data-testid="button-confirm-create-template">{t("common.create", "Create")}</Button></DialogFooter></DialogContent></Dialog>
    </div>
  );
}