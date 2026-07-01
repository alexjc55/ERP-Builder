import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import {
  useListEntities,
  useListEntityFields,
  useListEntityStatuses,
  useListEntityRelations,
  usePreviewEntityImport,
  useCommitEntityImport,
  getListEntityFieldsQueryKey,
  getListEntityStatusesQueryKey,
  getListEntityRelationsQueryKey,
  type Entity,
  type Field,
  type Status,
  type Relation,
  type ImportRequest,
  type ImportResult,
} from "@workspace/api-client-react";
import { useML, useT } from "@/lib/i18n";
import { normalizeSelectOptions } from "@/lib/selectOptions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Upload, Download, FileSpreadsheet, Loader2, CheckCircle2, XCircle, RefreshCw } from "lucide-react";

// Field types that cannot be filled from a spreadsheet cell.
const NON_IMPORTABLE = new Set(["file", "function", "relation", "lookup"]);

const STATUS_HEADER = "Статус / Status";

type ColMap =
  | { kind: "ignore" }
  | { kind: "field"; fieldKey: string }
  | { kind: "relation"; relationId: number }
  | { kind: "status" };

const MAP_IGNORE = "ignore";
const MAP_STATUS = "status";
const encodeMap = (m: ColMap): string =>
  m.kind === "field" ? `field:${m.fieldKey}` : m.kind === "relation" ? `rel:${m.relationId}` : m.kind;
function decodeMap(v: string): ColMap {
  if (v === MAP_STATUS) return { kind: "status" };
  if (v.startsWith("field:")) return { kind: "field", fieldKey: v.slice(6) };
  if (v.startsWith("rel:")) return { kind: "relation", relationId: Number(v.slice(4)) };
  return { kind: "ignore" };
}

const norm = (s: string) => s.trim().toLowerCase();
const splitMulti = (raw: unknown): string[] =>
  raw == null ? [] : String(raw).split(/[;\n]+/).map((s) => s.trim()).filter((s) => s !== "");

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
      <SelectTrigger className="h-8 w-[220px]">
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

export default function ImportPage() {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: entitiesData, isLoading: entitiesLoading } = useListEntities();
  const entities: Entity[] = (entitiesData ?? []).filter((e) => e.isActive);

  const [entityId, setEntityId] = useState<number | null>(null);
  const { data: fieldsData } = useListEntityFields(entityId ?? 0, {
    query: { enabled: entityId != null, queryKey: getListEntityFieldsQueryKey(entityId ?? 0) },
  });
  const { data: statusesData } = useListEntityStatuses(entityId ?? 0, {
    query: { enabled: entityId != null, queryKey: getListEntityStatusesQueryKey(entityId ?? 0) },
  });
  const { data: relationsData } = useListEntityRelations(entityId ?? 0, {
    query: { enabled: entityId != null, queryKey: getListEntityRelationsQueryKey(entityId ?? 0) },
  });

  const fields: Field[] = useMemo(
    () => (fieldsData ?? []).filter((f) => f.isActive && !NON_IMPORTABLE.has(f.fieldType)),
    [fieldsData],
  );
  const statuses: Status[] = useMemo(() => statusesData ?? [], [statusesData]);
  const relations: Relation[] = useMemo(() => relationsData ?? [], [relationsData]);

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [mapping, setMapping] = useState<ColMap[]>([]);
  const [relTargetKeys, setRelTargetKeys] = useState<Record<number, string>>({});
  const [keyFieldKey, setKeyFieldKey] = useState<string>("");

  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [committed, setCommitted] = useState<ImportResult | null>(null);

  const previewMut = usePreviewEntityImport();
  const commitMut = useCommitEntityImport();

  function resetData() {
    setHeaders([]);
    setRows([]);
    setFileName("");
    setMapping([]);
    setRelTargetKeys({});
    setKeyFieldKey("");
    setPreview(null);
    setCommitted(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onPickEntity(id: number) {
    setEntityId(id);
    resetData();
  }

  // ── Template download ──────────────────────────────────────────────────────
  // Built with exceljs so select fields and the status column get real Excel
  // dropdown lists (data validation). Allowed values live on a hidden "Списки"
  // sheet and each column references its range, so users pick valid values while
  // filling instead of only discovering mistakes at the preview step. The labels
  // written here are exactly what the server's matchOption / resolveStatusId
  // accept (option display label ru→en→he→value; status name ru→en→he→key).
  const TEMPLATE_ROWS = 1000;

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

  async function downloadTemplate() {
    if (entityId == null) return;
    try {
      const entity = entities.find((e) => e.id === entityId);
      const header: string[] = [
        ...fields.map((f) => ml(f.nameJson) || f.fieldKey),
        ...relations.map((r) => ml(r.nameJson) || r.relationKey),
        STATUS_HEADER,
      ];

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Import");
      const lists = wb.addWorksheet("Списки");
      lists.state = "hidden";

      ws.addRow(header);
      ws.getRow(1).font = { bold: true };
      ws.columns.forEach((col) => {
        col.width = 22;
      });

      // Collect dropdown specs: (0-based import column) → allowed values.
      const dropdowns: { col: number; values: string[] }[] = [];
      fields.forEach((f, i) => {
        if (f.fieldType !== "select") return;
        const values = normalizeSelectOptions(f.optionsJson)
          .map((o) => ml(o.labelJson) || o.value)
          .filter((v) => v.trim() !== "");
        if (values.length > 0) dropdowns.push({ col: i, values });
      });
      const statusValues = statuses
        .map((s) => ml(s.nameJson) || s.statusKey)
        .filter((v) => v.trim() !== "");
      if (statusValues.length > 0) {
        dropdowns.push({ col: fields.length + relations.length, values: statusValues });
      }

      // Write each list to its own column on the hidden sheet, then point the
      // matching import column's rows at that range via list data-validation.
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
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const base = (entity ? ml(entity.nameJson) || entity.entityKey : "import").replace(/[^\w\-]+/g, "_");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}_template.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: t("import.templateError", "Не удалось создать шаблон"), variant: "destructive" });
    }
  }

  // ── File parse + auto-map ──────────────────────────────────────────────────
  function autoMap(hdrs: string[]): ColMap[] {
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

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error("empty");
      const ws = wb.Sheets[firstSheet]!;
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
      if (aoa.length === 0) throw new Error("empty");
      const hdrs = (aoa[0] as unknown[]).map((c) => (c == null ? "" : String(c)));
      const dataRows = aoa.slice(1).filter((r) => (r as unknown[]).some((c) => c != null && String(c).trim() !== ""));
      setFileName(file.name);
      setHeaders(hdrs);
      setRows(dataRows);
      setMapping(autoMap(hdrs));
      setPreview(null);
      setCommitted(null);
    } catch {
      toast({ title: t("import.parseError", "Не удалось прочитать файл"), variant: "destructive" });
    }
  }

  // ── Build request ──────────────────────────────────────────────────────────
  function buildRequest(): ImportRequest | null {
    const usedRelationIds = new Set<number>();
    mapping.forEach((m) => {
      if (m.kind === "relation") usedRelationIds.add(m.relationId);
    });
    for (const relId of usedRelationIds) {
      if (!relTargetKeys[relId]) {
        const rel = relations.find((r) => r.id === relId);
        toast({
          title: t("import.missingTargetKey", "Выберите поле поиска для связи") + `: ${rel ? ml(rel.nameJson) : relId}`,
          variant: "destructive",
        });
        return null;
      }
    }
    const importRows = rows.map((cells, i) => {
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
      keyFieldKey: keyFieldKey || null,
      relationColumns,
      rows: importRows,
    };
  }

  async function runPreview() {
    if (entityId == null) return;
    const req = buildRequest();
    if (!req) return;
    try {
      const res = await previewMut.mutateAsync({ entityId, data: req });
      setPreview(res);
      setCommitted(null);
    } catch {
      toast({ title: t("import.previewError", "Ошибка проверки"), variant: "destructive" });
    }
  }

  async function runCommit() {
    if (entityId == null) return;
    const req = buildRequest();
    if (!req) return;
    try {
      const res = await commitMut.mutateAsync({ entityId, data: req });
      setCommitted(res);
      toast({
        title: t("import.done", "Импорт завершён"),
        description: `${t("import.created", "Создано")}: ${res.created} · ${t("import.updated", "Обновлено")}: ${res.updated} · ${t("import.errors", "Ошибок")}: ${res.errors}`,
      });
    } catch {
      toast({ title: t("import.commitError", "Ошибка импорта"), variant: "destructive" });
    }
  }

  function downloadErrorReport(result: ImportResult) {
    const failed = result.rows.filter((r) => r.status === "error");
    const lines = [
      `${t("import.row", "Строка")},${t("import.message", "Сообщение")}`,
      ...failed.map((r) => `${r.index},"${(r.message ?? "").replace(/"/g, '""')}"`),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import_errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const busy = previewMut.isPending || commitMut.isPending;
  const result = committed ?? preview;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("import.title", "Импорт данных")}</h1>
          <p className="text-sm text-slate-500">
            {t("import.subtitle", "Загрузка записей из файла XLSX/CSV с проверкой по правилам сущности")}
          </p>
        </div>
      </div>

      {/* Step 1: entity */}
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Label className="text-sm font-semibold text-slate-700">{t("import.step1", "1. Выберите сущность")}</Label>
          {entitiesLoading ? (
            <Skeleton className="h-9 w-72" />
          ) : (
            <Select value={entityId != null ? String(entityId) : undefined} onValueChange={(v) => onPickEntity(Number(v))}>
              <SelectTrigger className="w-72">
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
          )}
        </CardContent>
      </Card>

      {entityId != null && (
        <>
          {/* Step 2: template + upload */}
          <Card>
            <CardContent className="space-y-4 pt-6">
              <Label className="text-sm font-semibold text-slate-700">{t("import.step2", "2. Шаблон и файл")}</Label>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={downloadTemplate}>
                  <Download className="mr-2 h-4 w-4" />
                  {t("import.downloadTemplate", "Скачать шаблон")}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={onFileChange}
                />
                <Button type="button" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="mr-2 h-4 w-4" />
                  {t("import.uploadFile", "Загрузить файл")}
                </Button>
                {fileName && (
                  <span className="flex items-center gap-2 text-sm text-slate-600">
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                    {fileName}
                    <Badge variant="secondary">
                      {rows.length} {t("import.rowsCount", "строк")}
                    </Badge>
                    <Button type="button" variant="ghost" size="sm" onClick={resetData}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Step 3: mapping */}
          {headers.length > 0 && (
            <Card>
              <CardContent className="space-y-4 pt-6">
                <Label className="text-sm font-semibold text-slate-700">{t("import.step3", "3. Сопоставление колонок")}</Label>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("import.column", "Колонка файла")}</TableHead>
                        <TableHead>{t("import.sample", "Пример")}</TableHead>
                        <TableHead>{t("import.mapTo", "Поле / связь / статус")}</TableHead>
                        <TableHead>{t("import.targetKey", "Поиск по полю")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {headers.map((h, c) => {
                        const m = mapping[c] ?? { kind: "ignore" };
                        const sample = rows.find((r) => r[c] != null && String(r[c]).trim() !== "")?.[c];
                        return (
                          <TableRow key={c}>
                            <TableCell className="font-medium">{h || `#${c + 1}`}</TableCell>
                            <TableCell className="max-w-[200px] truncate text-slate-500">
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
                                <SelectTrigger className="h-8 w-[260px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={MAP_IGNORE}>{t("import.ignore", "— Пропустить —")}</SelectItem>
                                  <SelectItem value={MAP_STATUS}>{t("import.status", "Статус")}</SelectItem>
                                  {fields.map((f) => (
                                    <SelectItem key={`field:${f.fieldKey}`} value={`field:${f.fieldKey}`}>
                                      {ml(f.nameJson) || f.fieldKey}
                                    </SelectItem>
                                  ))}
                                  {relations.map((r) => (
                                    <SelectItem key={`rel:${r.id}`} value={`rel:${r.id}`}>
                                      🔗 {ml(r.nameJson) || r.relationKey}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
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
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

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
                  <span className="text-xs text-slate-400">
                    {t("import.upsertHint", "Совпадающие записи будут обновлены, остальные — добавлены")}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" onClick={runPreview} disabled={busy || rows.length === 0}>
                    {previewMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {t("import.preview", "Проверить (без записи)")}
                  </Button>
                  <Button
                    type="button"
                    onClick={runCommit}
                    disabled={busy || rows.length === 0 || !preview || preview.errors === preview.total}
                  >
                    {commitMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    {t("import.commit", "Импортировать")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step 4: result */}
          {result && (
            <Card>
              <CardContent className="space-y-4 pt-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Label className="text-sm font-semibold text-slate-700">
                    {committed ? t("import.resultCommit", "Результат импорта") : t("import.resultPreview", "Результат проверки")}
                  </Label>
                  <Badge variant="secondary">{t("import.total", "Всего")}: {result.total}</Badge>
                  <Badge className="bg-emerald-100 text-emerald-700">{t("import.created", "Создано")}: {result.created}</Badge>
                  <Badge className="bg-blue-100 text-blue-700">{t("import.updated", "Обновлено")}: {result.updated}</Badge>
                  {result.skipped > 0 && (
                    <Badge className="bg-slate-100 text-slate-600">{t("import.skipped", "Пропущено")}: {result.skipped}</Badge>
                  )}
                  <Badge className={result.errors > 0 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-500"}>
                    {t("import.errors", "Ошибок")}: {result.errors}
                  </Badge>
                  {result.errors > 0 && (
                    <Button type="button" variant="outline" size="sm" onClick={() => downloadErrorReport(result)}>
                      <Download className="mr-2 h-4 w-4" />
                      {t("import.downloadErrors", "Скачать отчёт об ошибках")}
                    </Button>
                  )}
                </div>

                {result.errors > 0 && (
                  <div className="max-h-80 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-20">{t("import.row", "Строка")}</TableHead>
                          <TableHead className="w-28">{t("import.statusCol", "Статус")}</TableHead>
                          <TableHead>{t("import.message", "Сообщение")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.rows
                          .filter((r) => r.status === "error")
                          .map((r) => (
                            <TableRow key={r.index}>
                              <TableCell>{r.index}</TableCell>
                              <TableCell>
                                <span className="flex items-center gap-1 text-red-600">
                                  <XCircle className="h-4 w-4" /> {t("import.error", "Ошибка")}
                                </span>
                              </TableCell>
                              <TableCell className="text-slate-700">{r.message}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {result.errors === 0 && (
                  <p className="flex items-center gap-2 text-sm text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                    {committed
                      ? t("import.allOkCommit", "Все строки импортированы без ошибок")
                      : t("import.allOkPreview", "Ошибок не найдено — можно импортировать")}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
