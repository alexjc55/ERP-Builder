import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import {
  useListEntities,
  useListEntityFields,
  useListEntityStatuses,
  useListEntityRelations,
  useListPages,
  useListPageFields,
  usePreviewImport,
  useCommitImport,
  getListEntityFieldsQueryKey,
  getListEntityStatusesQueryKey,
  getListEntityRelationsQueryKey,
  getListPageFieldsQueryKey,
  type Entity,
  type Field,
  type Status,
  type Relation,
  type Page,
  type PageField,
  type BatchImportFile,
  type BatchImportResult,
  type BatchImportFileResult,
  type ImportRow,
} from "@workspace/api-client-react";
import { useML, useT } from "@/lib/i18n";
import { normalizeSelectOptions } from "@/lib/selectOptions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Upload,
  Download,
  FileSpreadsheet,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  AlertTriangle,
  Plus,
} from "lucide-react";

// Field types that cannot be filled from a spreadsheet cell.
const NON_IMPORTABLE = new Set(["file", "function", "relation", "lookup"]);

const STATUS_HEADER = "Статус / Status";

// A file is either an ENTITY file (writes entity records) or a PAGE file (writes
// page-local values on a mirror page, located per row by a host-record key).
type FileKind = "entity" | "page";

type ColMap =
  | { kind: "ignore" }
  | { kind: "field"; fieldKey: string } // entity field OR page-local field (per file kind)
  | { kind: "relation"; relationId: number } // entity files only
  | { kind: "status" } // entity files only
  | { kind: "hostkey" }; // page files only — the value locating the host record

const MAP_IGNORE = "ignore";
const MAP_STATUS = "status";
const MAP_HOSTKEY = "hostkey";
const encodeMap = (m: ColMap): string =>
  m.kind === "field" ? `field:${m.fieldKey}` : m.kind === "relation" ? `rel:${m.relationId}` : m.kind;
function decodeMap(v: string): ColMap {
  if (v === MAP_STATUS) return { kind: "status" };
  if (v === MAP_HOSTKEY) return { kind: "hostkey" };
  if (v.startsWith("field:")) return { kind: "field", fieldKey: v.slice(6) };
  if (v.startsWith("rel:")) return { kind: "relation", relationId: Number(v.slice(4)) };
  return { kind: "ignore" };
}

const norm = (s: string) => s.trim().toLowerCase();
const splitMulti = (raw: unknown): string[] =>
  raw == null ? [] : String(raw).split(/[;\n]+/).map((s) => s.trim()).filter((s) => s !== "");

let fileSeq = 0;

type ParsedData = {
  fileName: string;
  headers: string[];
  rows: unknown[][];
};

// A card is the unit of the wizard: pick a target first, download its template,
// then attach the filled file. `data` is null until a file has been attached.
type CardState = {
  id: string;
  data: ParsedData | null;
};

async function parseSpreadsheet(file: File): Promise<ParsedData | null> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return null;
  const ws = wb.Sheets[firstSheet]!;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (aoa.length === 0) return null;
  const hdrs = (aoa[0] as unknown[]).map((c) => (c == null ? "" : String(c)));
  const dataRows = aoa.slice(1).filter((r) => (r as unknown[]).some((c) => c != null && String(c).trim() !== ""));
  return { fileName: file.name, headers: hdrs, rows: dataRows };
}

function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** Picks which field on a relation's target entity is used to resolve links by value. */
function RelationTargetKeyPicker({
  relation,
  value,
  onChange,
}: {
  relation: Relation;
  value: string;
  onChange: (fieldKey: string) => void;
}) {
  const ml = useML();
  const t = useT();
  const { data } = useListEntityFields(relation.targetEntityId);
  const fields = (data ?? []).filter((f) => f.isActive && !NON_IMPORTABLE.has(f.fieldType));
  return (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-[200px]">
        <SelectValue placeholder={t("import.pickTargetKey", "Поле для поиска…")} />
      </SelectTrigger>
      <SelectContent>
        {fields.map((f) => (
          <SelectItem key={f.fieldKey} value={f.fieldKey}>
            {ml(f.nameJson)}
            {f.isKey ? " ★" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ── Per-file configuration card ──────────────────────────────────────────────

function FileCard({
  card,
  index,
  entities,
  pages,
  result,
  onBuilt,
  onRemove,
  onFileParsed,
}: {
  card: CardState;
  index: number;
  entities: Entity[];
  pages: Page[];
  result: BatchImportFileResult | undefined;
  onBuilt: (id: string, file: BatchImportFile | null) => void;
  onRemove: (id: string) => void;
  onFileParsed: (id: string, data: ParsedData | null) => void;
}) {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const cardFileInputRef = useRef<HTMLInputElement>(null);

  const data = card.data;
  const headers = data?.headers ?? [];
  const rows = data?.rows ?? [];
  const fileName = data?.fileName ?? "";

  const [kind, setKind] = useState<FileKind>("entity");
  const [entityId, setEntityId] = useState<number | null>(null);
  const [pageId, setPageId] = useState<number | null>(null);
  const [mapping, setMapping] = useState<ColMap[]>([]);
  const [relTargetKeys, setRelTargetKeys] = useState<Record<number, string>>({});
  const [keyFieldKey, setKeyFieldKey] = useState<string>("");
  const [hostKeyFieldKey, setHostKeyFieldKey] = useState<string>("");

  // Entity-file metadata.
  const { data: fieldsData } = useListEntityFields(entityId ?? 0, {
    query: { enabled: kind === "entity" && entityId != null, queryKey: getListEntityFieldsQueryKey(entityId ?? 0) },
  });
  const { data: statusesData } = useListEntityStatuses(entityId ?? 0, {
    query: { enabled: kind === "entity" && entityId != null, queryKey: getListEntityStatusesQueryKey(entityId ?? 0) },
  });
  const { data: relationsData } = useListEntityRelations(entityId ?? 0, {
    query: { enabled: kind === "entity" && entityId != null, queryKey: getListEntityRelationsQueryKey(entityId ?? 0) },
  });

  // Page-file metadata: the page's page-local fields + the mirrored entity's
  // fields (used to pick the host-record lookup field).
  const selectedPage = pages.find((p) => p.id === pageId) ?? null;
  const mirrorEntityId = selectedPage?.mirrorEntityId ?? null;
  const { data: pageFieldsData } = useListPageFields(pageId ?? 0, {
    query: { enabled: kind === "page" && pageId != null, queryKey: getListPageFieldsQueryKey(pageId ?? 0) },
  });
  const { data: mirrorFieldsData } = useListEntityFields(mirrorEntityId ?? 0, {
    query: { enabled: kind === "page" && mirrorEntityId != null, queryKey: getListEntityFieldsQueryKey(mirrorEntityId ?? 0) },
  });

  const fields: Field[] = useMemo(
    () => (fieldsData ?? []).filter((f) => f.isActive && !NON_IMPORTABLE.has(f.fieldType)),
    [fieldsData],
  );
  const statuses: Status[] = useMemo(() => statusesData ?? [], [statusesData]);
  const relations: Relation[] = useMemo(() => relationsData ?? [], [relationsData]);
  const pageFields: PageField[] = useMemo(
    () => (pageFieldsData ?? []).filter((f) => !NON_IMPORTABLE.has(f.fieldType)),
    [pageFieldsData],
  );
  const mirrorFields: Field[] = useMemo(() => (mirrorFieldsData ?? []).filter((f) => f.isActive), [mirrorFieldsData]);

  const mirrorPages = useMemo(() => pages.filter((p) => p.mirrorEntityId != null), [pages]);

  // ── Auto-map columns once the target + its metadata are known ───────────────
  const autoMap = useMemo(
    () =>
      (hdrs: string[]): ColMap[] => {
        if (kind === "entity") {
          return hdrs.map((h): ColMap => {
            const n = norm(h);
            if (!n) return { kind: "ignore" };
            if (n === norm(STATUS_HEADER) || n === "статус" || n === "status") return { kind: "status" };
            const f = fields.find((x) => norm(ml(x.nameJson)) === n || norm(x.fieldKey) === n);
            if (f) return { kind: "field", fieldKey: f.fieldKey };
            const r = relations.find((x) => norm(ml(x.nameJson)) === n || norm(x.relationKey) === n);
            if (r) return { kind: "relation", relationId: r.id };
            return { kind: "ignore" };
          });
        }
        return hdrs.map((h): ColMap => {
          const n = norm(h);
          if (!n) return { kind: "ignore" };
          const f = pageFields.find((x) => norm(ml(x.nameJson)) === n || norm(x.fieldKey) === n);
          if (f) return { kind: "field", fieldKey: f.fieldKey };
          return { kind: "ignore" };
        });
      },
    [kind, fields, relations, pageFields, ml],
  );

  const sig = `${kind}:${entityId ?? ""}:${pageId ?? ""}:${headers.join("|")}`;
  const autoRef = useRef<string>("");
  const metaReady =
    kind === "entity" ? entityId != null && !!fieldsData : pageId != null && !!pageFieldsData;
  useEffect(() => {
    if (!metaReady) return;
    if (autoRef.current === sig) return;
    autoRef.current = sig;
    setMapping(autoMap(headers));
    setRelTargetKeys({});
    setKeyFieldKey("");
    setHostKeyFieldKey("");
  }, [sig, metaReady, autoMap, headers]);

  // ── Build the BatchImportFile (null = not ready) + a human warning ──────────
  const { file, warning } = useMemo((): { file: BatchImportFile | null; warning: string | null } => {
    if (!data) return { file: null, warning: t("import.needFile", "Загрузите заполненный файл") };
    if (kind === "entity") {
      if (entityId == null) return { file: null, warning: t("import.needEntity", "Выберите сущность") };
      const usedRelationIds = new Set<number>();
      mapping.forEach((m) => m.kind === "relation" && usedRelationIds.add(m.relationId));
      for (const relId of usedRelationIds) {
        if (!relTargetKeys[relId]) {
          const rel = relations.find((r) => r.id === relId);
          return {
            file: null,
            warning: `${t("import.missingTargetKey", "Выберите поле поиска для связи")}: ${rel ? ml(rel.nameJson) : relId}`,
          };
        }
      }
      const rows: ImportRow[] = data.rows.map((cells, i) => {
        const values: Record<string, unknown> = {};
        const rels: Record<string, string[]> = {};
        let statusName: string | null = null;
        mapping.forEach((m, c) => {
          const raw = cells[c];
          if (m.kind === "field") values[m.fieldKey] = raw;
          else if (m.kind === "relation") rels[String(m.relationId)] = splitMulti(raw);
          else if (m.kind === "status") statusName = raw == null || String(raw).trim() === "" ? null : String(raw);
        });
        return {
          index: i + 2,
          values,
          relations: Object.keys(rels).length > 0 ? rels : undefined,
          statusName,
        };
      });
      const relationColumns = [...usedRelationIds].map((relId) => ({
        relationId: relId,
        targetKeyFieldKey: relTargetKeys[relId]!,
      }));
      return {
        file: { kind: "entity", label: data.fileName, entityId, keyFieldKey: keyFieldKey || null, relationColumns, rows },
        warning: null,
      };
    }

    // Page file.
    if (pageId == null) return { file: null, warning: t("import.needPage", "Выберите страницу") };
    const hostCol = mapping.findIndex((m) => m.kind === "hostkey");
    if (hostCol < 0) return { file: null, warning: t("import.needHostCol", "Укажите колонку с ключом записи") };
    if (!hostKeyFieldKey) return { file: null, warning: t("import.needHostField", "Выберите поле поиска записи") };
    const rows: ImportRow[] = data.rows.map((cells, i) => {
      const values: Record<string, unknown> = {};
      mapping.forEach((m, c) => {
        if (m.kind === "field") values[m.fieldKey] = cells[c];
      });
      const hraw = cells[hostCol];
      return {
        index: i + 2,
        values,
        hostKeyValue: hraw == null || String(hraw).trim() === "" ? null : String(hraw),
      };
    });
    return { file: { kind: "page", label: data.fileName, pageId, hostKeyFieldKey, rows }, warning: null };
  }, [kind, entityId, pageId, mapping, relTargetKeys, keyFieldKey, hostKeyFieldKey, relations, data, ml, t]);

  useEffect(() => {
    onBuilt(card.id, file);
  }, [file, card.id, onBuilt]);

  async function handleCardFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const parsedData = await parseSpreadsheet(f);
      if (!parsedData) {
        toast({ title: `${t("import.parseError", "Не удалось прочитать файл")}: ${f.name}`, variant: "destructive" });
      } else {
        onFileParsed(card.id, parsedData);
      }
    } catch {
      toast({ title: `${t("import.parseError", "Не удалось прочитать файл")}: ${f.name}`, variant: "destructive" });
    }
    if (cardFileInputRef.current) cardFileInputRef.current.value = "";
  }

  // ── Template download (dropdowns for select fields + status) ────────────────
  async function downloadTemplate() {
    try {
      const header: string[] = [];
      const dropdowns: { col: number; values: string[] }[] = [];
      let base = "import";
      if (kind === "entity") {
        const entity = entities.find((e) => e.id === entityId);
        base = entity ? ml(entity.nameJson) || entity.entityKey : "import";
        fields.forEach((f, i) => {
          header.push(ml(f.nameJson) || f.fieldKey);
          if (f.fieldType === "select") {
            const values = normalizeSelectOptions(f.optionsJson).map((o) => ml(o.labelJson) || o.value).filter((v) => v.trim() !== "");
            if (values.length > 0) dropdowns.push({ col: i, values });
          }
        });
        relations.forEach((r) => header.push(ml(r.nameJson) || r.relationKey));
        header.push(STATUS_HEADER);
        const statusValues = statuses.map((s) => ml(s.nameJson) || s.statusKey).filter((v) => v.trim() !== "");
        if (statusValues.length > 0) dropdowns.push({ col: fields.length + relations.length, values: statusValues });
      } else {
        base = selectedPage ? ml(selectedPage.nameJson) || String(selectedPage.id) : "import";
        const hostField = mirrorFields.find((f) => f.fieldKey === hostKeyFieldKey);
        header.push(hostField ? `${ml(hostField.nameJson) || hostField.fieldKey} (ключ)` : "Ключ записи");
        pageFields.forEach((f, i) => {
          header.push(ml(f.nameJson) || f.fieldKey);
          if (f.fieldType === "select") {
            const values = normalizeSelectOptions(f.optionsJson).map((o) => ml(o.labelJson) || o.value).filter((v) => v.trim() !== "");
            if (values.length > 0) dropdowns.push({ col: i + 1, values });
          }
        });
      }

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Import");
      const lists = wb.addWorksheet("Списки");
      lists.state = "hidden";
      ws.addRow(header);
      ws.getRow(1).font = { bold: true };
      ws.columns.forEach((col) => {
        col.width = 22;
      });
      const TEMPLATE_ROWS = 1000;
      dropdowns.forEach((d, li) => {
        const listCol = li + 1;
        d.values.forEach((v, r) => {
          lists.getCell(r + 1, listCol).value = v;
        });
        const letter = colLetter(listCol);
        const range = `'Списки'!$${letter}$1:$${letter}$${d.values.length}`;
        const impLetter = colLetter(d.col + 1);
        for (let r = 2; r <= TEMPLATE_ROWS; r++) {
          ws.getCell(`${impLetter}${r}`).dataValidation = {
            type: "list",
            allowBlank: true,
            formulae: [range],
            showErrorMessage: true,
            errorStyle: "error",
            errorTitle: t("import.badValueTitle", "Недопустимое значение"),
            error: t("import.badValueMsg", "Выберите значение из списка"),
          };
        }
      });

      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base.replace(/[^\w\-]+/g, "_")}_template.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: t("import.templateError", "Не удалось создать шаблон"), variant: "destructive" });
    }
  }

  const fieldOptions = kind === "entity" ? fields : pageFields;

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        {/* Header: file name + kind + target */}
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">#{index + 1}</Badge>
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <FileSpreadsheet className={`h-4 w-4 ${data ? "text-emerald-600" : "text-slate-300"}`} />
            {data ? fileName : t("import.noFileYet", "Файл не загружен")}
          </span>
          {data && (
            <Badge variant="secondary">
              {rows.length} {t("import.rowsCount", "строк")}
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(card.id)}>
              <Trash2 className="h-4 w-4 text-red-500" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={kind} onValueChange={(v) => setKind(v as FileKind)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="entity">{t("import.kindEntity", "Записи сущности")}</SelectItem>
              <SelectItem value="page">{t("import.kindPage", "Значения страницы")}</SelectItem>
            </SelectContent>
          </Select>

          {kind === "entity" ? (
            <Select value={entityId != null ? String(entityId) : undefined} onValueChange={(v) => setEntityId(Number(v))}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder={t("import.pickEntity", "Сущность…")} />
              </SelectTrigger>
              <SelectContent>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={String(e.id)}>
                    {ml(e.nameJson) || e.entityKey}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Select value={pageId != null ? String(pageId) : undefined} onValueChange={(v) => setPageId(Number(v))}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder={t("import.pickPage", "Зеркальная страница…")} />
              </SelectTrigger>
              <SelectContent>
                {mirrorPages.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {ml(p.nameJson) || String(p.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {kind === "page" && pageId != null && (
            <Select value={hostKeyFieldKey || undefined} onValueChange={setHostKeyFieldKey}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder={t("import.pickHostField", "Поле поиска записи…")} />
              </SelectTrigger>
              <SelectContent>
                {mirrorFields.map((f) => (
                  <SelectItem key={f.fieldKey} value={f.fieldKey}>
                    {ml(f.nameJson) || f.fieldKey}
                    {f.isKey ? " ★" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate} disabled={metaReady === false}>
            <Download className="mr-2 h-4 w-4" />
            {t("import.downloadTemplate", "Шаблон")}
          </Button>

          <input
            ref={cardFileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={handleCardFile}
          />
          <Button
            type="button"
            variant={data ? "outline" : "default"}
            size="sm"
            onClick={() => cardFileInputRef.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" />
            {data ? t("import.replaceFile", "Заменить файл") : t("import.attachFile", "Загрузить заполненный файл")}
          </Button>
        </div>

        {metaReady && !data && (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Download className="h-4 w-4" />
            {t("import.templateHint", "Скачайте шаблон, заполните его и загрузите заполненный файл")}
          </p>
        )}

        {/* Column mapping */}
        {metaReady && data && (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("import.column", "Колонка файла")}</TableHead>
                  <TableHead>{t("import.sample", "Пример")}</TableHead>
                  <TableHead>{t("import.mapTo", "Назначение")}</TableHead>
                  {kind === "entity" && <TableHead>{t("import.targetKey", "Поиск по полю")}</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {headers.map((h, c) => {
                  const m = mapping[c] ?? { kind: "ignore" };
                  const sample = rows.find((r) => r[c] != null && String(r[c]).trim() !== "")?.[c];
                  return (
                    <TableRow key={c}>
                      <TableCell className="font-medium">{h || `#${c + 1}`}</TableCell>
                      <TableCell className="max-w-[180px] truncate text-slate-500">
                        {sample == null ? "—" : String(sample)}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={encodeMap(m)}
                          onValueChange={(v) => {
                            const next = [...mapping];
                            next[c] = decodeMap(v);
                            setMapping(next);
                          }}
                        >
                          <SelectTrigger className="h-8 w-[240px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={MAP_IGNORE}>{t("import.ignore", "— Пропустить —")}</SelectItem>
                            {kind === "entity" && <SelectItem value={MAP_STATUS}>{t("import.status", "Статус")}</SelectItem>}
                            {kind === "page" && (
                              <SelectItem value={MAP_HOSTKEY}>{t("import.hostkey", "🔑 Ключ записи")}</SelectItem>
                            )}
                            {fieldOptions.map((f) => (
                              <SelectItem key={`field:${f.fieldKey}`} value={`field:${f.fieldKey}`}>
                                {ml(f.nameJson) || f.fieldKey}
                              </SelectItem>
                            ))}
                            {kind === "entity" &&
                              relations.map((r) => (
                                <SelectItem key={`rel:${r.id}`} value={`rel:${r.id}`}>
                                  🔗 {ml(r.nameJson) || r.relationKey}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      {kind === "entity" && (
                        <TableCell>
                          {m.kind === "relation" ? (
                            <RelationTargetKeyPicker
                              relation={relations.find((r) => r.id === m.relationId)!}
                              value={relTargetKeys[m.relationId] ?? ""}
                              onChange={(fk) => setRelTargetKeys((prev) => ({ ...prev, [m.relationId]: fk }))}
                            />
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Entity upsert key */}
        {metaReady && data && kind === "entity" && (
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Label className="text-sm text-slate-600">{t("import.upsertKey", "Ключ для обновления (upsert)")}</Label>
            <Select value={keyFieldKey || "__none__"} onValueChange={(v) => setKeyFieldKey(v === "__none__" ? "" : v)}>
              <SelectTrigger className="w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t("import.insertOnly", "Без обновления (только добавление)")}</SelectItem>
                {fields.map((f) => (
                  <SelectItem key={f.fieldKey} value={f.fieldKey}>
                    {ml(f.nameJson) || f.fieldKey}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Not-ready warning */}
        {warning && (
          <p className="flex items-center gap-2 text-sm text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            {warning}
          </p>
        )}

        {/* Per-file result */}
        {result && <FileResultView index={index} result={result} />}
      </CardContent>
    </Card>
  );
}

// ── Per-file result summary + error rows ─────────────────────────────────────

function FileResultView({ index, result }: { index: number; result: BatchImportFileResult }) {
  const t = useT();
  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">#{index + 1}</Badge>
        {result.error ? (
          <span className="flex items-center gap-1 text-sm text-red-600">
            <XCircle className="h-4 w-4" /> {result.error}
          </span>
        ) : (
          <>
            <Badge className="bg-emerald-100 text-emerald-700">
              {t("import.created", "Создано")}: {result.created}
            </Badge>
            <Badge className="bg-blue-100 text-blue-700">
              {t("import.updated", "Обновлено")}: {result.updated}
            </Badge>
            {result.skipped > 0 && (
              <Badge className="bg-slate-100 text-slate-600">
                {t("import.skipped", "Пропущено")}: {result.skipped}
              </Badge>
            )}
            <Badge className={result.errors > 0 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"}>
              {t("import.errors", "Ошибок")}: {result.errors}
            </Badge>
          </>
        )}
      </div>
      {result.rows.some((r) => r.status === "error") && (
        <div className="max-h-64 overflow-y-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">{t("import.row", "Строка")}</TableHead>
                <TableHead>{t("import.message", "Сообщение")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows
                .filter((r) => r.status === "error")
                .map((r) => (
                  <TableRow key={r.index}>
                    <TableCell>{r.index}</TableCell>
                    <TableCell className="text-slate-700">{r.message}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ImportPage() {
  const t = useT();
  const ml = useML();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: entitiesData } = useListEntities();
  const entities: Entity[] = useMemo(() => (entitiesData ?? []).filter((e) => e.isActive), [entitiesData]);
  const { data: pagesData } = useListPages();
  const pages: Page[] = useMemo(() => pagesData ?? [], [pagesData]);

  const [cards, setCards] = useState<CardState[]>([]);
  const [built, setBuilt] = useState<Record<string, BatchImportFile | null>>({});
  const [result, setResult] = useState<BatchImportResult | null>(null);
  const [committed, setCommitted] = useState(false);
  const [sentIds, setSentIds] = useState<string[]>([]);

  const previewMut = usePreviewImport();
  const commitMut = useCommitImport();
  const busy = previewMut.isPending || commitMut.isPending;

  const onBuilt = useMemo(
    () => (id: string, file: BatchImportFile | null) => {
      setBuilt((prev) => (prev[id] === file ? prev : { ...prev, [id]: file }));
    },
    [],
  );

  const onFileParsed = useMemo(
    () => (id: string, data: ParsedData | null) => {
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, data } : c)));
      setResult(null);
      setCommitted(false);
    },
    [],
  );

  function addCard() {
    setCards((prev) => [...prev, { id: `f${++fileSeq}`, data: null }]);
    setResult(null);
    setCommitted(false);
  }

  function removeFile(id: string) {
    setCards((prev) => prev.filter((c) => c.id !== id));
    setBuilt((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setResult(null);
    setCommitted(false);
  }

  async function onFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const newCards: CardState[] = [];
    for (const file of Array.from(list)) {
      try {
        const data = await parseSpreadsheet(file);
        if (data) newCards.push({ id: `f${++fileSeq}`, data });
        else toast({ title: `${t("import.parseError", "Не удалось прочитать файл")}: ${file.name}`, variant: "destructive" });
      } catch {
        toast({ title: `${t("import.parseError", "Не удалось прочитать файл")}: ${file.name}`, variant: "destructive" });
      }
    }
    if (newCards.length > 0) {
      setCards((prev) => [...prev, ...newCards]);
      setResult(null);
      setCommitted(false);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const allReady = cards.length > 0 && cards.every((c) => built[c.id] != null);

  function buildBatch(): { files: BatchImportFile[]; ids: string[] } {
    const ids: string[] = [];
    const batch: BatchImportFile[] = [];
    for (const c of cards) {
      const b = built[c.id];
      if (b != null) {
        ids.push(c.id);
        batch.push(b);
      }
    }
    return { files: batch, ids };
  }

  async function runPreview() {
    const { files: batch, ids } = buildBatch();
    if (batch.length === 0) return;
    try {
      const res = await previewMut.mutateAsync({ data: { files: batch } });
      setResult(res);
      setSentIds(ids);
      setCommitted(false);
    } catch {
      toast({ title: t("import.previewError", "Ошибка проверки"), variant: "destructive" });
    }
  }

  async function runCommit() {
    const { files: batch, ids } = buildBatch();
    if (batch.length === 0) return;
    try {
      const res = await commitMut.mutateAsync({ data: { files: batch } });
      setResult(res);
      setSentIds(ids);
      setCommitted(true);
      const totals = res.files.reduce(
        (acc, f) => ({ created: acc.created + f.created, updated: acc.updated + f.updated, errors: acc.errors + f.errors }),
        { created: 0, updated: 0, errors: 0 },
      );
      toast({
        title: res.ok ? t("import.done", "Импорт завершён") : t("import.commitRolledBack", "Импорт отменён (есть ошибки)"),
        description: `${t("import.created", "Создано")}: ${totals.created} · ${t("import.updated", "Обновлено")}: ${totals.updated} · ${t("import.errors", "Ошибок")}: ${totals.errors}`,
        variant: res.ok ? undefined : "destructive",
      });
    } catch {
      toast({ title: t("import.commitError", "Ошибка импорта"), variant: "destructive" });
    }
  }

  const resultByFileId = useMemo(() => {
    const map: Record<string, BatchImportFileResult> = {};
    if (result) {
      for (const fr of result.files) {
        const id = sentIds[fr.index];
        if (id) map[id] = fr;
      }
    }
    return map;
  }, [result, sentIds]);

  const hasErrors = !!result && !result.ok;

  function downloadErrors() {
    if (!result) return;
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const header = [
      t("import.file", "Файл"),
      t("import.target", "Цель"),
      t("import.row", "Строка"),
      t("import.message", "Сообщение"),
    ];
    const lines: string[] = [header.map(esc).join(",")];
    for (const fr of result.files) {
      const id = sentIds[fr.index];
      const card = id ? cards.find((c) => c.id === id) : undefined;
      const bf = id ? built[id] : undefined;
      const fileLabel = `#${fr.index + 1} ${card?.data?.fileName ?? bf?.label ?? ""}`.trim();
      let target = "";
      if (bf?.kind === "entity") {
        const e = entities.find((x) => x.id === bf.entityId);
        target = e ? ml(e.nameJson) || e.entityKey : "";
      } else if (bf?.kind === "page") {
        const p = pages.find((x) => x.id === bf.pageId);
        target = p ? ml(p.nameJson) || String(p.id) : "";
      }
      if (fr.error) {
        lines.push([fileLabel, target, "", fr.error].map(esc).join(","));
      }
      for (const r of fr.rows) {
        if (r.status === "error") {
          lines.push([fileLabel, target, String(r.index), r.message ?? ""].map(esc).join(","));
        }
      }
    }
    const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import_errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{t("import.title", "Импорт данных")}</h1>
        <p className="text-sm text-slate-500">
          {t(
            "import.subtitleBatch",
            "Добавьте файлы: для каждого выберите цель, скачайте шаблон, заполните его и загрузите. Всё импортируется одной проверенной операцией (всё или ничего в рамках пакета)",
          )}
        </p>
      </div>

      {/* Add cards */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <Button type="button" onClick={addCard}>
            <Plus className="mr-2 h-4 w-4" />
            {t("import.addCard", "Добавить файл")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            className="hidden"
            onChange={onFilesChange}
          />
          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" />
            {t("import.uploadFiles", "Загрузить готовые файлы")}
          </Button>
          {cards.length > 0 && (
            <Badge variant="secondary">
              {cards.length} {t("import.filesCount", "файлов")}
            </Badge>
          )}
        </CardContent>
      </Card>

      {/* Per-file cards */}
      {cards.map((c, i) => (
        <FileCard
          key={c.id}
          card={c}
          index={i}
          entities={entities}
          pages={pages}
          result={resultByFileId[c.id]}
          onBuilt={onBuilt}
          onRemove={removeFile}
          onFileParsed={onFileParsed}
        />
      ))}

      {/* Actions */}
      {cards.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 pt-6">
            <Button type="button" variant="outline" onClick={runPreview} disabled={busy || !allReady}>
              {previewMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("import.preview", "Проверить (без записи)")}
            </Button>
            <Button type="button" onClick={runCommit} disabled={busy || !allReady || !result || !result.ok || committed}>
              {commitMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("import.commit", "Импортировать")}
            </Button>
            {hasErrors && (
              <Button type="button" variant="outline" onClick={downloadErrors}>
                <Download className="mr-2 h-4 w-4" />
                {t("import.downloadErrors", "Скачать ошибки (CSV)")}
              </Button>
            )}
            {result && (
              <span className="flex items-center gap-2 text-sm">
                {result.ok ? (
                  <span className="flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    {committed
                      ? t("import.allOkCommit", "Все строки импортированы без ошибок")
                      : t("import.allOkPreview", "Ошибок не найдено — можно импортировать")}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-red-600">
                    <XCircle className="h-4 w-4" />
                    {committed
                      ? t("import.commitRolledBack", "Импорт отменён (есть ошибки)")
                      : t("import.hasErrors", "Найдены ошибки — исправьте перед импортом")}
                  </span>
                )}
              </span>
            )}
            {!allReady && cards.length > 0 && (
              <span className="text-xs text-slate-400">{t("import.configureAll", "Настройте все файлы, чтобы продолжить")}</span>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
