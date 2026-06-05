import { useState, useEffect, useMemo, useRef } from "react";
import {
  useListEntityRecords,
  useCreateEntityRecord,
  useUpdateRecord,
  useDeleteRecord,
  useListEntityFields,
  useListEntityStatuses,
  useListEntityTransitions,
  useListEntityRelations,
  useListEntityViews,
  useQueryEntityRecords,
  useArchiveRecord,
  useUnarchiveRecord,
  useListRecordLinks,
  useCreateRecordLink,
  useDeleteRecordLink,
  useListUserOptions,
  useListRecordAuditLogs,
  type ArchiveFilter,
  type AuditLogEntry,
  type EntityRecord,
  type Field,
  type Status,
  type Relation,
  type View,
  type ViewConfig,
  type Transition,
  type RecordQuery,
  type LinkedRecord,
  type UserOption,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useML, useT } from "@/lib/i18n";
import { FieldConfigDialog } from "@/components/FieldConfigDialog";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, Inbox, Link2, X, Search, LayoutList, ChevronLeft, ChevronRight, Star, ShieldAlert, Archive, ArchiveRestore, History, Settings2, Check } from "lucide-react";

const NO_STATUS = "__none__";
const NO_VIEW = "__all__";
const PAGE_SIZE = 50;

function extractError(err: unknown): string | undefined {
  if (err && typeof err === "object" && "response" in err) {
    const resp = (err as { response?: { data?: { error?: string } } }).response;
    return resp?.data?.error;
  }
  return undefined;
}

type FormState = Record<string, string | number | boolean>;

function emptyForField(field: Field): string | number | boolean {
  if (field.fieldType === "boolean") return false;
  if (field.fieldType === "number") return "";
  return "";
}

function valueToForm(field: Field, value: unknown): string | number | boolean {
  if (field.fieldType === "boolean") return value === true;
  if (field.fieldType === "number") return typeof value === "number" ? value : "";
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** Build the payload values object from form state, dropping empty optional values. */
function formToValues(fields: Field[], form: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = form[field.fieldKey];
    if (field.fieldType === "boolean") {
      out[field.fieldKey] = Boolean(raw);
      continue;
    }
    if (raw === "" || raw === undefined || raw === null) continue;
    if (field.fieldType === "number") {
      out[field.fieldKey] = Number(raw);
    } else {
      out[field.fieldKey] = raw;
    }
  }
  return out;
}

function renderCellValue(field: Field, value: unknown, userNames?: Map<number, string>): React.ReactNode {
  if (value === undefined || value === null || value === "") return <span className="text-slate-300">—</span>;
  if (field.fieldType === "boolean") {
    return value ? (
      <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">Да</Badge>
    ) : (
      <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">Нет</Badge>
    );
  }
  if (field.fieldType === "user") {
    const id = typeof value === "number" ? value : Number(value);
    const name = userNames?.get(id);
    return <span className="text-slate-700">{name ?? `#${value}`}</span>;
  }
  if (field.fieldType === "url") {
    return (
      <a href={String(value)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
        {String(value)}
      </a>
    );
  }
  return <span className="text-slate-700">{String(value)}</span>;
}

export function EntityRecords({ entityId }: { entityId: number }) {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canRecord, canAdmin, fieldAccess, user } = useAuth();

  const canView = canRecord(entityId, "view");
  const canCreate = canRecord(entityId, "create");
  const canUpdate = canRecord(entityId, "update");
  const canDelete = canRecord(entityId, "delete");
  // Field/column management (setup mode) is gated exactly like the fields builder.
  const canConfigureColumns = canAdmin("entities");

  const { data: allFields = [], isLoading: fieldsLoading } = useListEntityFields(entityId);
  const { data: statuses = [] } = useListEntityStatuses(entityId);
  const { data: transitions = [] } = useListEntityTransitions(entityId);
  const { data: views = [] } = useListEntityViews(entityId);
  const { data: userOptions = [] } = useListUserOptions();

  const userNames = useMemo(
    () => new Map(userOptions.map((u: UserOption) => [u.id, u.name])),
    [userOptions],
  );

  const fields = [...allFields]
    .filter((f: Field) => f.isActive)
    .sort((a: Field, b: Field) => a.sortOrder - b.sortOrder);
  // Fields the current user is allowed to see (not hidden by field-level perms).
  const visibleFormFields = fields.filter((f: Field) => fieldAccess(f, entityId) !== "hidden");
  // Columns shown in the records table. A field explicitly marked "hidden" for the
  // current role drops its whole column even for a superAdmin (display-only — the
  // field stays editable in the record dialog and the server bypass is unchanged).
  const currentRoleId = user?.roleId;
  const tableFields = visibleFormFields.filter(
    (f: Field) =>
      currentRoleId == null ||
      f.permissionsJson?.[String(currentRoleId)] !== "hidden",
  );
  const statusById = new Map(statuses.map((s: Status) => [s.id, s]));
  const isSuperAdmin = user?.permissions?.superAdmin === true;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [toDelete, setToDelete] = useState<EntityRecord | null>(null);
  const [historyFor, setHistoryFor] = useState<EntityRecord | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [statusId, setStatusId] = useState<string>(NO_STATUS);

  // Google-Sheets-style inline editing: which cell is currently being edited.
  const [editingCell, setEditingCell] = useState<{ recordId: number; fieldKey: string | "__status__" } | null>(null);
  // Inline "add row" draft state (an alternative to the modal create dialog).
  const [addingRow, setAddingRow] = useState(false);
  const [newRow, setNewRow] = useState<FormState>({});
  const [newRowStatus, setNewRowStatus] = useState<string>(NO_STATUS);
  // Admin-only setup mode: clicking a column header configures it; "+" adds a column.
  const [setupMode, setSetupMode] = useState(false);
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [columnField, setColumnField] = useState<Field | null>(null);

  // Leaving an entity resets the transient table-editing UI so it can't leak across entities.
  useEffect(() => {
    setEditingCell(null);
    setAddingRow(false);
    setSetupMode(false);
  }, [entityId]);

  // Statuses the user may move the record to, mirroring the server's workflow boundary.
  // Free choice when: creating, no transitions defined, current status is null, or superAdmin.
  // Otherwise: current status + targets of transitions allowed for the user's role.
  const currentEditStatusId = editing?.statusId ?? null;
  const workflowActive =
    !!editing && transitions.length > 0 && currentEditStatusId != null && !isSuperAdmin;
  const allowedStatusIds: Set<number> | null = workflowActive
    ? new Set<number>([
        currentEditStatusId as number,
        ...transitions
          .filter(
            (t: Transition) =>
              t.fromStatusId === currentEditStatusId &&
              ((t.allowedRoleIds?.length ?? 0) === 0 ||
                (user?.roleId != null && t.allowedRoleIds.includes(user.roleId))),
          )
          .map((t: Transition) => t.toStatusId),
      ])
    : null;
  const selectableStatuses = allowedStatusIds
    ? statuses.filter((s: Status) => allowedStatusIds.has(s.id))
    : statuses;

  // View / filter / search / pagination state for the server-side query endpoint.
  const [selectedViewId, setSelectedViewId] = useState<string>(NO_VIEW);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState<ArchiveFilter>("active");
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<EntityRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);

  const selectedView: View | undefined =
    selectedViewId === NO_VIEW ? undefined : views.find((v: View) => String(v.id) === selectedViewId);
  const selectedConfig = (selectedView?.configJson ?? {}) as ViewConfig;

  // Reset all view/query state when switching entities so prior state never leaks.
  const [viewInitialized, setViewInitialized] = useState(false);
  useEffect(() => {
    setSelectedViewId(NO_VIEW);
    setSearch("");
    setArchived("active");
    setPage(1);
    setViewInitialized(false);
  }, [entityId]);

  // Auto-select the entity's default view once its views load (only on first arrival).
  useEffect(() => {
    if (viewInitialized || views.length === 0) return;
    const def = views.find((v: View) => v.isDefault);
    if (def) {
      setSelectedViewId(String(def.id));
      setSearch(((def.configJson ?? {}) as ViewConfig).search ?? "");
    }
    setViewInitialized(true);
  }, [views, viewInitialized]);

  const queryMutation = useQueryEntityRecords();
  const runQuery = queryMutation.mutateAsync;

  const recordQuery: RecordQuery = useMemo(
    () => ({
      filters: selectedConfig.filters ?? [],
      filterConjunction: selectedConfig.filterConjunction ?? "and",
      sorts: selectedConfig.sorts ?? [],
      search: search.trim() || undefined,
      archived,
      page,
      pageSize: PAGE_SIZE,
    }),
    [selectedConfig.filters, selectedConfig.filterConjunction, selectedConfig.sorts, search, archived, page],
  );

  const queryKey = JSON.stringify(recordQuery);
  useEffect(() => {
    if (!canView) {
      setRecordsLoading(false);
      return;
    }
    let cancelled = false;
    setRecordsLoading(true);
    runQuery({ entityId, data: recordQuery })
      .then((res) => {
        if (cancelled) return;
        setRecords(res.data);
        setTotal(res.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setRecords([]);
        setTotal(0);
        toast({ title: t("records.loadError", "Ошибка загрузки записей"), description: extractError(err), variant: "destructive" });
      })
      .finally(() => {
        if (!cancelled) setRecordsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, queryKey, refreshTick]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/records`] });
    setRefreshTick((t) => t + 1);
  };
  const invalidateFields = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/fields`] });
  };

  const handleViewChange = (value: string) => {
    setSelectedViewId(value);
    setPage(1);
    const cfg = value === NO_VIEW ? undefined : (views.find((v: View) => String(v.id) === value)?.configJson as ViewConfig | undefined);
    setSearch(cfg?.search ?? "");
  };

  const createMutation = useCreateEntityRecord({
    mutation: {
      onSuccess: () => { toast({ title: t("records.created", "Запись создана") }); setDialogOpen(false); setAddingRow(false); invalidate(); },
      onError: (err) => toast({ title: t("records.createError", "Ошибка создания записи"), description: extractError(err), variant: "destructive" }),
    },
  });
  // Dedicated mutation for inline cell/status edits — quietly refreshes (no success toast spam).
  const cellUpdateMutation = useUpdateRecord({
    mutation: {
      onSuccess: () => { setEditingCell(null); invalidate(); },
      onError: (err) => { setEditingCell(null); toast({ title: t("records.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }); },
    },
  });
  const updateMutation = useUpdateRecord({
    mutation: {
      onSuccess: () => { toast({ title: t("records.updated", "Запись обновлена") }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: t("records.updateError", "Ошибка обновления"), description: extractError(err), variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteRecord({
    mutation: {
      onSuccess: () => { toast({ title: t("records.deleted", "Запись удалена") }); setToDelete(null); invalidate(); },
      onError: () => toast({ title: t("records.deleteError", "Ошибка удаления записи"), variant: "destructive" }),
    },
  });
  const archiveMutation = useArchiveRecord({
    mutation: {
      onSuccess: () => { toast({ title: t("records.archived", "Запись отправлена в архив") }); invalidate(); },
      onError: (err) => toast({ title: t("records.archiveError", "Ошибка архивации"), description: extractError(err), variant: "destructive" }),
    },
  });
  const unarchiveMutation = useUnarchiveRecord({
    mutation: {
      onSuccess: () => { toast({ title: t("records.unarchived", "Запись восстановлена из архива") }); invalidate(); },
      onError: (err) => toast({ title: t("records.unarchiveError", "Ошибка восстановления"), description: extractError(err), variant: "destructive" }),
    },
  });

  const openCreate = () => {
    setEditing(null);
    const initial: FormState = {};
    for (const f of fields) initial[f.fieldKey] = emptyForField(f);
    setForm(initial);
    const def = statuses.find((s: Status) => s.isDefault);
    setStatusId(def ? String(def.id) : NO_STATUS);
    setDialogOpen(true);
  };

  const openEdit = (record: EntityRecord) => {
    setEditing(record);
    const initial: FormState = {};
    const values = (record.valuesJson ?? {}) as Record<string, unknown>;
    for (const f of fields) initial[f.fieldKey] = valueToForm(f, values[f.fieldKey]);
    setForm(initial);
    setStatusId(record.statusId != null ? String(record.statusId) : NO_STATUS);
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    // Only send fields the user can see; hidden/view-only are preserved server-side.
    const valuesJson = formToValues(visibleFormFields, form);
    const statusValue = statusId === NO_STATUS ? null : Number(statusId);
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: { valuesJson, statusId: statusValue } });
    } else {
      createMutation.mutate({ entityId, data: { valuesJson, statusId: statusValue } });
    }
  };

  // Inline editing is available outside setup mode for users who can update records.
  const inlineEditEnabled = canUpdate && !setupMode;

  // Coerce a raw form value into the JSON shape the API expects for one field.
  // Empty string is sent verbatim to clear an optional field (server drops empties).
  const cellValueForPayload = (field: Field, raw: string | number | boolean): unknown => {
    if (field.fieldType === "boolean") return Boolean(raw);
    if (raw === "" || raw === undefined || raw === null) return "";
    if (field.fieldType === "number") return Number(raw);
    if (field.fieldType === "user") return Number(raw);
    return raw;
  };

  const commitCell = (record: EntityRecord, field: Field, raw: string | number | boolean) => {
    const stored = (record.valuesJson ?? {})[field.fieldKey];
    const next = cellValueForPayload(field, raw);
    const normalizedStored =
      field.fieldType === "boolean" ? Boolean(stored) : stored === undefined || stored === null ? "" : stored;
    if (next === normalizedStored) { setEditingCell(null); return; }
    cellUpdateMutation.mutate({ id: record.id, data: { valuesJson: { [field.fieldKey]: next } } });
  };

  const commitStatus = (record: EntityRecord, value: string) => {
    const next = value === NO_STATUS ? null : Number(value);
    if (next === (record.statusId ?? null)) { setEditingCell(null); return; }
    cellUpdateMutation.mutate({ id: record.id, data: { statusId: next } });
  };

  // Whether workflow enforcement applies to a given row (mirrors the server boundary).
  // When active the status cannot be cleared and only allowed transitions are offered.
  const workflowActiveForRecord = (record: EntityRecord): boolean =>
    transitions.length > 0 && record.statusId != null && !isSuperAdmin;

  // Statuses a given row may move to, mirroring the server workflow boundary (per-row).
  const allowedStatusesForRecord = (record: EntityRecord): Status[] => {
    if (!workflowActiveForRecord(record)) return statuses;
    const cur = record.statusId ?? null;
    const ids = new Set<number>([
      cur as number,
      ...transitions
        .filter(
          (tr: Transition) =>
            tr.fromStatusId === cur &&
            ((tr.allowedRoleIds?.length ?? 0) === 0 ||
              (user?.roleId != null && tr.allowedRoleIds.includes(user.roleId))),
        )
        .map((tr: Transition) => tr.toStatusId),
    ]);
    return statuses.filter((s: Status) => ids.has(s.id));
  };

  const startAddRow = () => {
    const initial: FormState = {};
    for (const f of fields) initial[f.fieldKey] = emptyForField(f);
    setNewRow(initial);
    const def = statuses.find((s: Status) => s.isDefault);
    setNewRowStatus(def ? String(def.id) : NO_STATUS);
    setEditingCell(null);
    setAddingRow(true);
  };

  const commitNewRow = () => {
    const valuesJson = formToValues(
      visibleFormFields.filter((f: Field) => fieldAccess(f, entityId) === "edit"),
      newRow,
    );
    const statusValue = newRowStatus === NO_STATUS ? null : Number(newRowStatus);
    createMutation.mutate({ entityId, data: { valuesJson, statusId: statusValue } });
  };

  const openColumnConfig = (field: Field | null) => {
    setColumnField(field);
    setColumnDialogOpen(true);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const visibleFields = selectedConfig.visibleFields;
  const displayFields =
    visibleFields && visibleFields.length > 0
      ? (visibleFields
          .map((key) => tableFields.find((f: Field) => f.fieldKey === key))
          .filter((f): f is Field => Boolean(f)))
      : tableFields.slice(0, 5);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (!canView) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6 text-red-500" />
          </div>
          <p className="text-slate-700 font-medium">{t("records.noAccess", "Нет доступа к записям")}</p>
          <p className="text-sm text-slate-400 max-w-md">
            {t("records.noAccessDesc", "У вашей роли нет прав на просмотр данных этой сущности.")}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (fieldsLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (fields.length === 0) {
    return (
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="flex flex-col items-center justify-center text-center py-16 gap-3">
          <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
            <Inbox className="w-6 h-6 text-amber-500" />
          </div>
          <p className="text-slate-700 font-medium">{t("records.noFields", "У этой сущности ещё нет полей")}</p>
          <p className="text-sm text-slate-400 max-w-md">
            {t("records.noFieldsDesc", "Сначала настройте поля в конструкторе полей — без них нельзя создавать записи.")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {views.length > 0 && (
            <div className="flex items-center gap-1.5">
              <LayoutList className="w-4 h-4 text-slate-400" />
              <Select value={selectedViewId} onValueChange={handleViewChange}>
                <SelectTrigger className="h-9 w-56 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VIEW}>{t("records.allRecords", "Все записи")}</SelectItem>
                  {views.map((v: View) => (
                    <SelectItem key={v.id} value={String(v.id)}>
                      <span className="inline-flex items-center gap-1.5">
                        {v.isDefault && <Star className="w-3 h-3 text-amber-500 fill-amber-400" />}
                        {ml(v.nameJson)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder={t("records.searchPlaceholder", "Поиск…")}
              className="h-9 w-56 pl-8 text-sm"
            />
          </div>
          <div className="flex items-center rounded-md border border-slate-200 p-0.5 bg-white">
            {([
              ["active", t("records.filterActive", "Активные")],
              ["archived", t("records.filterArchived", "Архив")],
              ["all", t("records.filterAll", "Все")],
            ] as [ArchiveFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => { setArchived(value); setPage(1); }}
                className={`px-2.5 h-8 text-xs rounded-[5px] transition ${
                  archived === value
                    ? "bg-slate-800 text-white"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canConfigureColumns && (
            <Button
              type="button"
              variant={setupMode ? "default" : "outline"}
              onClick={() => { setSetupMode((s) => !s); setEditingCell(null); setAddingRow(false); }}
              className={setupMode ? "bg-amber-500 hover:bg-amber-600 gap-2" : "gap-2"}
            >
              <Settings2 className="w-4 h-4" />
              {t("records.setupMode", "Режим настройки")}
            </Button>
          )}
          {canCreate && !setupMode && (
            <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
              <Plus className="w-4 h-4" />
              {t("records.add", "Добавить запись")}
            </Button>
          )}
        </div>
      </div>

      {setupMode && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          <Settings2 className="w-4 h-4" />
          {t("records.setupHint", "Режим настройки включён. Нажмите на заголовок колонки, чтобы изменить её свойства и права, или «+», чтобы добавить новую колонку.")}
        </div>
      )}

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {recordsLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {displayFields.map((f: Field) => (
                      <th key={f.id} className="text-left px-4 py-3 font-medium text-slate-600 whitespace-nowrap">
                        {setupMode ? (
                          <button
                            type="button"
                            onClick={() => openColumnConfig(f)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-1 text-amber-700 hover:bg-amber-100 transition"
                            title={t("records.configureColumn", "Настроить колонку")}
                          >
                            {ml(f.nameJson)}
                            <Settings2 className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          ml(f.nameJson)
                        )}
                      </th>
                    ))}
                    {statuses.length > 0 && (
                      <th className="text-left px-4 py-3 font-medium text-slate-600">{t("records.status", "Статус")}</th>
                    )}
                    {setupMode ? (
                      <th className="text-right px-4 py-3 font-medium text-slate-600">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => openColumnConfig(null)}
                          className="bg-amber-500 hover:bg-amber-600 gap-1.5 h-8"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          {t("records.addColumn", "Колонка")}
                        </Button>
                      </th>
                    ) : (
                      <th className="text-right px-4 py-3 font-medium text-slate-600">{t("records.actions", "Действия")}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {records.length === 0 && (
                    <tr>
                      <td
                        colSpan={displayFields.length + (statuses.length > 0 ? 1 : 0) + 1}
                        className="text-center py-12 text-slate-400"
                      >
                        {total === 0 && (search.trim() || (selectedConfig.filters?.length ?? 0) > 0)
                          ? t("records.emptyFiltered", "Нет записей, удовлетворяющих условиям.")
                          : t("records.emptyNone", "Записей пока нет. Нажмите «Добавить запись», чтобы создать первую.")}
                      </td>
                    </tr>
                  )}
                  {records.map((record: EntityRecord) => {
                    const values = (record.valuesJson ?? {}) as Record<string, unknown>;
                    const status = record.statusId != null ? statusById.get(record.statusId) : undefined;
                    return (
                      <tr key={record.id} className="border-b border-slate-100 hover:bg-slate-50">
                        {displayFields.map((f: Field) => {
                          const access = fieldAccess(f, entityId);
                          const cellEditable = inlineEditEnabled && access === "edit";
                          const isEditingThis =
                            editingCell?.recordId === record.id && editingCell?.fieldKey === f.fieldKey;
                          if (isEditingThis) {
                            return (
                              <td key={f.id} className="px-2 py-1.5 max-w-[260px]">
                                <InlineCellEditor
                                  field={f}
                                  initial={valueToForm(f, values[f.fieldKey])}
                                  userOptions={userOptions}
                                  onCommit={(raw) => commitCell(record, f, raw)}
                                  onCancel={() => setEditingCell(null)}
                                />
                              </td>
                            );
                          }
                          if (f.fieldType === "boolean" && cellEditable) {
                            return (
                              <td key={f.id} className="px-4 py-3 max-w-[240px]">
                                <Switch
                                  checked={values[f.fieldKey] === true}
                                  onCheckedChange={(v) => commitCell(record, f, v)}
                                />
                              </td>
                            );
                          }
                          return (
                            <td
                              key={f.id}
                              onClick={cellEditable ? () => setEditingCell({ recordId: record.id, fieldKey: f.fieldKey }) : undefined}
                              className={`px-4 py-3 max-w-[240px] truncate ${cellEditable ? "cursor-text hover:bg-blue-50/60 rounded" : ""}`}
                              title={cellEditable ? t("records.clickToEdit", "Нажмите, чтобы изменить") : undefined}
                            >
                              {renderCellValue(f, values[f.fieldKey], userNames)}
                            </td>
                          );
                        })}
                        {statuses.length > 0 && (
                          <td className="px-4 py-3">
                            {editingCell?.recordId === record.id && editingCell?.fieldKey === "__status__" ? (
                              <Select
                                defaultOpen
                                value={record.statusId != null ? String(record.statusId) : NO_STATUS}
                                onValueChange={(v) => commitStatus(record, v)}
                                onOpenChange={(o) => { if (!o) setEditingCell(null); }}
                              >
                                <SelectTrigger className="h-8 w-44 text-sm"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {!workflowActiveForRecord(record) && (
                                    <SelectItem value={NO_STATUS}>{t("records.noStatus", "Без статуса")}</SelectItem>
                                  )}
                                  {allowedStatusesForRecord(record).map((s: Status) => (
                                    <SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                            <div
                              className={`flex items-center gap-2 ${inlineEditEnabled ? "cursor-pointer rounded hover:bg-blue-50/60 -mx-1 px-1" : ""}`}
                              onClick={inlineEditEnabled ? () => setEditingCell({ recordId: record.id, fieldKey: "__status__" }) : undefined}
                              title={inlineEditEnabled ? t("records.clickToEdit", "Нажмите, чтобы изменить") : undefined}
                            >
                              {status ? (
                                <span
                                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={{ backgroundColor: `${status.color}20`, color: status.color }}
                                >
                                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: status.color }} />
                                  {ml(status.nameJson)}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                              {record.archivedAt && (
                                <span className="inline-flex items-center gap-1 text-indigo-500 text-xs">
                                  <Archive className="w-3 h-3" /> {t("records.inArchive", "В архиве")}
                                </span>
                              )}
                            </div>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {canUpdate && (
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(record)}>
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-slate-500"
                              title={t("records.history", "История изменений")}
                              onClick={() => setHistoryFor(record)}
                            >
                              <History className="w-3.5 h-3.5" />
                            </Button>
                            {canUpdate && (
                              record.archivedAt ? (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-indigo-500"
                                  title={t("records.restoreFromArchive", "Восстановить из архива")}
                                  disabled={unarchiveMutation.isPending}
                                  onClick={() => unarchiveMutation.mutate({ id: record.id })}
                                >
                                  <ArchiveRestore className="w-3.5 h-3.5" />
                                </Button>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-500"
                                  title={t("records.toArchive", "В архив")}
                                  disabled={archiveMutation.isPending}
                                  onClick={() => archiveMutation.mutate({ id: record.id })}
                                >
                                  <Archive className="w-3.5 h-3.5" />
                                </Button>
                              )
                            )}
                            {canDelete && (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setToDelete(record)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {!canUpdate && !canDelete && <span className="text-slate-300 text-xs">—</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {canCreate && !setupMode && addingRow && (
                    <tr className="border-b border-blue-100 bg-blue-50/40">
                      {displayFields.map((f: Field) => {
                        const editable = fieldAccess(f, entityId) === "edit";
                        return (
                          <td key={f.id} className="px-2 py-1.5 align-top max-w-[260px]">
                            {editable ? (
                              <FieldInput
                                field={f}
                                value={newRow[f.fieldKey]}
                                onChange={(v) => setNewRow((prev) => ({ ...prev, [f.fieldKey]: v }))}
                                userOptions={userOptions}
                              />
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                        );
                      })}
                      {statuses.length > 0 && (
                        <td className="px-2 py-1.5 align-top">
                          <Select value={newRowStatus} onValueChange={setNewRowStatus}>
                            <SelectTrigger className="h-8 w-44 text-sm"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_STATUS}>{t("records.noStatus", "Без статуса")}</SelectItem>
                              {statuses.map((s: Status) => (
                                <SelectItem key={s.id} value={String(s.id)}>{ml(s.nameJson)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                      )}
                      <td className="px-2 py-1.5 align-top">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            className="h-8 w-8 bg-blue-600 hover:bg-blue-700"
                            title={t("records.saveRow", "Сохранить строку")}
                            disabled={createMutation.isPending}
                            onClick={commitNewRow}
                          >
                            {createMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500"
                            title={t("records.cancel", "Отмена")}
                            onClick={() => setAddingRow(false)}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                  {canCreate && !setupMode && !addingRow && (
                    <tr className="border-b border-slate-100">
                      <td colSpan={displayFields.length + (statuses.length > 0 ? 1 : 0) + 1} className="px-2 py-2">
                        <button
                          type="button"
                          onClick={startAddRow}
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 transition"
                        >
                          <Plus className="w-4 h-4" />
                          {t("records.addRow", "Добавить строку")}
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {t("records.shown", "Показано")} {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} {t("records.of", "из")} {total}
          </span>
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={page <= 1 || recordsLoading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="w-3.5 h-3.5" /> {t("records.prev", "Назад")}
              </Button>
              <span className="text-xs text-slate-400">
                {t("records.page", "Стр.")} {page} {t("records.of", "из")} {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={page >= totalPages || recordsLoading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                {t("records.next", "Вперёд")} <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("records.editTitle", "Редактировать запись") : t("records.newTitle", "Новая запись")}</DialogTitle>
            <DialogDescription>
              {t("records.dialogDesc", "Заполните поля записи. Обязательные поля помечены звёздочкой.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {visibleFormFields.map((field: Field) => {
              const access = fieldAccess(field, entityId);
              const readOnly = access === "view";
              return (
                <div key={field.id} className="space-y-1.5">
                  <Label>
                    {ml(field.nameJson)}
                    {field.isRequired && <span className="text-red-500 ml-0.5">*</span>}
                    {readOnly && <span className="ml-1.5 text-xs font-normal text-slate-400">{t("records.readOnly", "(только чтение)")}</span>}
                  </Label>
                  <FieldInput
                    field={field}
                    value={form[field.fieldKey]}
                    onChange={(v) => setForm((prev) => ({ ...prev, [field.fieldKey]: v }))}
                    disabled={readOnly}
                    userOptions={userOptions}
                  />
                  {ml(field.descriptionJson) && (
                    <p className="text-xs text-slate-400">{ml(field.descriptionJson)}</p>
                  )}
                </div>
              );
            })}

            {statuses.length > 0 && (
              <div className="space-y-1.5">
                <Label>{t("records.status", "Статус")}</Label>
                <Select value={statusId} onValueChange={setStatusId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("records.noStatus", "Без статуса")} />
                  </SelectTrigger>
                  <SelectContent>
                    {!workflowActive && <SelectItem value={NO_STATUS}>{t("records.noStatus", "Без статуса")}</SelectItem>}
                    {selectableStatuses.map((s: Status) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {ml(s.nameJson)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {workflowActive && (
                  <p className="text-xs text-slate-400">
                    {t("records.workflowHint", "Доступны только разрешённые процессом переходы из текущего статуса.")}
                  </p>
                )}
                {(() => {
                  if (!workflowActive) return null;
                  const targetId = statusId === NO_STATUS ? null : Number(statusId);
                  if (targetId == null || targetId === currentEditStatusId) return null;
                  const matchedTransition = transitions.find(
                    (tr: Transition) =>
                      tr.fromStatusId === currentEditStatusId && tr.toStatusId === targetId,
                  );
                  const req = matchedTransition?.requiredFieldKeys ?? [];
                  if (req.length === 0) return null;
                  return (
                    <p className="text-xs text-amber-600">
                      {t("records.transitionRequired", "Для перехода нужно заполнить:")}{" "}
                      {req
                        .map((k) => ml(fields.find((f: Field) => f.fieldKey === k)?.nameJson) || k)
                        .join(", ")}
                    </p>
                  );
                })()}
              </div>
            )}

            {editing && <RecordLinkManager entityId={entityId} recordId={editing.id} />}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("records.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? t("records.save", "Сохранить") : t("records.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("records.deleteTitle", "Удалить запись?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("records.deleteConfirm", "Запись будет удалена безвозвратно.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("records.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => toDelete && deleteMutation.mutate({ id: toDelete.id })}
            >
              {t("records.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RecordHistoryDialog
        record={historyFor}
        onClose={() => setHistoryFor(null)}
        fieldNameByKey={new Map(allFields.map((f: Field) => [f.fieldKey, ml(f.nameJson)]))}
        statusById={statusById}
      />

      {canConfigureColumns && (
        <FieldConfigDialog
          open={columnDialogOpen}
          onOpenChange={setColumnDialogOpen}
          entityId={entityId}
          field={columnField}
          nextSortOrder={allFields.length + 1}
          onSaved={() => { invalidateFields(); }}
        />
      )}
    </div>
  );
}

const AUDIT_RESERVED: Record<string, string> = {
  __status__: "Статус",
  __archived__: "Архив",
  __created__: "Запись создана",
  __deleted__: "Запись удалена",
};

function RecordHistoryDialog({
  record,
  onClose,
  fieldNameByKey,
  statusById,
}: {
  record: EntityRecord | null;
  onClose: () => void;
  fieldNameByKey: Map<string, string>;
  statusById: Map<number, Status>;
}) {
  const t = useT();
  return (
    <Dialog open={!!record} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("records.history", "История изменений")}</DialogTitle>
          <DialogDescription>{t("records.historyDesc", "Кто, когда и что изменил: прежнее значение → новое.")}</DialogDescription>
        </DialogHeader>
        {record && (
          <RecordHistoryList recordId={record.id} fieldNameByKey={fieldNameByKey} statusById={statusById} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecordHistoryList({
  recordId,
  fieldNameByKey,
  statusById,
}: {
  recordId: number;
  fieldNameByKey: Map<string, string>;
  statusById: Map<number, Status>;
}) {
  const ml = useML();
  const t = useT();
  const { data: entries = [], isLoading } = useListRecordAuditLogs(recordId);

  const fieldLabel = (key: string | null): string => {
    if (!key) return "—";
    if (AUDIT_RESERVED[key]) return AUDIT_RESERVED[key];
    return fieldNameByKey.get(key) || key;
  };

  const renderValue = (key: string | null, value: string | null): string => {
    if (value === null) return "∅";
    if (key === "__status__") {
      const s = statusById.get(Number(value));
      return s ? ml(s.nameJson) : value;
    }
    if (key === "__archived__") return value === "true" ? t("records.yes", "Да") : t("records.no", "Нет");
    return value;
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
        <Inbox className="w-8 h-8" />
        <p className="text-sm">{t("records.historyEmpty", "Изменений пока нет")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400 border-b">
            <th className="px-3 py-2 font-medium">{t("records.when", "Когда")}</th>
            <th className="px-3 py-2 font-medium">{t("records.who", "Кто")}</th>
            <th className="px-3 py-2 font-medium">{t("records.field", "Поле")}</th>
            <th className="px-3 py-2 font-medium">{t("records.change", "Изменение")}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e: AuditLogEntry) => (
            <tr key={e.id} className="border-b last:border-0 align-top">
              <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                {new Date(e.createdAt).toLocaleString("ru-RU")}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{e.userName || "—"}</td>
              <td className="px-3 py-2">{fieldLabel(e.fieldKey)}</td>
              <td className="px-3 py-2">
                {e.fieldKey === "__created__" || e.fieldKey === "__deleted__" ? (
                  <span className="text-slate-500">
                    {e.fieldKey === "__deleted__" && e.oldValue ? e.oldValue : "—"}
                  </span>
                ) : (
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-400 line-through">{renderValue(e.fieldKey, e.oldValue)}</span>
                    <span className="text-slate-300">→</span>
                    <span className="text-slate-700 font-medium">{renderValue(e.fieldKey, e.newValue)}</span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Inline (in-cell) editor used by the Google-Sheets-style records table.
 * Text-like inputs commit on Enter/blur and cancel on Escape; select/user
 * commit on choice. Boolean is handled by the table itself (toggles in place).
 */
function InlineCellEditor({
  field,
  initial,
  userOptions,
  onCommit,
  onCancel,
}: {
  field: Field;
  initial: string | number | boolean;
  userOptions: UserOption[];
  onCommit: (raw: string | number | boolean) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string | number | boolean>(initial);
  const cancelRef = useRef(false);
  const committedRef = useRef(false);

  const commitOnce = (raw: string | number | boolean) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(raw);
  };

  if (field.fieldType === "select" || field.fieldType === "user") {
    const options =
      field.fieldType === "user"
        ? userOptions.map((u) => ({ value: String(u.id), label: u.name }))
        : (Array.isArray(field.optionsJson) ? (field.optionsJson as string[]) : []).map((o) => ({ value: o, label: o }));
    return (
      <Select
        defaultOpen
        value={draft ? String(draft) : ""}
        onValueChange={(v) => commitOnce(field.fieldType === "user" ? Number(v) : v)}
        onOpenChange={(o) => { if (!o && !committedRef.current) onCancel(); }}
      >
        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t("records.selectValue", "Выберите значение")} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.fieldType === "textarea") {
    return (
      <Textarea
        autoFocus
        rows={2}
        className="text-sm"
        value={String(draft ?? "")}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Escape") { cancelRef.current = true; (e.target as HTMLTextAreaElement).blur(); } }}
        onBlur={() => { if (cancelRef.current) onCancel(); else commitOnce(draft); }}
      />
    );
  }

  const inputType =
    field.fieldType === "number" ? "number"
    : field.fieldType === "date" ? "date"
    : field.fieldType === "datetime" ? "datetime-local"
    : field.fieldType === "email" ? "email"
    : field.fieldType === "url" ? "url"
    : field.fieldType === "phone" ? "tel"
    : "text";

  return (
    <Input
      autoFocus
      type={inputType}
      className="h-8 text-sm"
      value={draft === "" || draft === undefined ? "" : String(draft)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
        else if (e.key === "Escape") { cancelRef.current = true; (e.target as HTMLInputElement).blur(); }
      }}
      onBlur={() => { if (cancelRef.current) onCancel(); else commitOnce(draft); }}
    />
  );
}

function FieldInput({
  field,
  value,
  onChange,
  disabled = false,
  userOptions = [],
}: {
  field: Field;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
  disabled?: boolean;
  userOptions?: UserOption[];
}) {
  const t = useT();
  switch (field.fieldType) {
    case "textarea":
      return <Textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <Switch checked={Boolean(value)} onCheckedChange={onChange} disabled={disabled} />
          <span className="text-sm text-slate-500">{value ? t("records.yes", "Да") : t("records.no", "Нет")}</span>
        </div>
      );
    case "number":
      return (
        <Input
          type="number"
          value={value === "" || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      );
    case "date":
      return <Input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "datetime":
      return <Input type="datetime-local" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "email":
      return <Input type="email" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "url":
      return <Input type="url" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder="https://" disabled={disabled} />;
    case "phone":
      return <Input type="tel" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
    case "user": {
      return (
        <Select
          value={value ? String(value) : ""}
          onValueChange={(v) => onChange(Number(v))}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("records.selectUser", "Выберите пользователя")} />
          </SelectTrigger>
          <SelectContent>
            {userOptions.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    case "select": {
      const options = Array.isArray(field.optionsJson) ? (field.optionsJson as string[]) : [];
      return (
        <Select value={value ? String(value) : ""} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger>
            <SelectValue placeholder={t("records.selectValue", "Выберите значение")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>{opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }
    default:
      return <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} disabled={disabled} />;
  }
}

/** Best-effort human label for a record: first non-empty field value, else `#id`. */
function recordLabel(record: EntityRecord): string {
  const values = (record.valuesJson ?? {}) as Record<string, unknown>;
  for (const v of Object.values(values)) {
    if (v !== undefined && v !== null && v !== "" && typeof v !== "object") {
      return String(v);
    }
  }
  return `#${record.id}`;
}

/** Link manager shown inside the record edit dialog. Lists each outgoing relation
 *  with its currently linked records and lets the user add/remove links. */
function RecordLinkManager({ entityId, recordId }: { entityId: number; recordId: number }) {
  const t = useT();
  const { data: relations = [], isLoading: relationsLoading } = useListEntityRelations(entityId);
  const { data: links = [], isLoading: linksLoading } = useListRecordLinks(recordId);

  if (relationsLoading) {
    return <Skeleton className="h-10 w-full" />;
  }
  if (relations.length === 0) {
    return null;
  }

  const linksByRelation = new Map<number, LinkedRecord[]>();
  for (const link of links) {
    const arr = linksByRelation.get(link.relationId) ?? [];
    arr.push(link);
    linksByRelation.set(link.relationId, arr);
  }

  return (
    <div className="space-y-4 border-t border-slate-100 pt-4">
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <Link2 className="w-4 h-4 text-blue-600" />
        {t("records.links", "Связи")}
      </div>
      {relations.map((relation: Relation) => (
        <RelationLinkSection
          key={relation.id}
          relation={relation}
          recordId={recordId}
          existingLinks={linksByRelation.get(relation.id) ?? []}
          linksLoading={linksLoading}
        />
      ))}
    </div>
  );
}

const PICK_PLACEHOLDER = "__pick__";

function RelationLinkSection({
  relation,
  recordId,
  existingLinks,
  linksLoading,
}: {
  relation: Relation;
  recordId: number;
  existingLinks: LinkedRecord[];
  linksLoading: boolean;
}) {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pick, setPick] = useState<string>(PICK_PLACEHOLDER);

  const { data: targetRecords = [], isLoading: targetLoading } = useListEntityRecords(
    relation.targetEntityId,
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/records/${recordId}/links`] });

  const createLink = useCreateRecordLink({
    mutation: {
      onSuccess: () => { setPick(PICK_PLACEHOLDER); invalidate(); },
      onError: (err) => toast({ title: t("records.linkAddError", "Не удалось добавить связь"), description: extractError(err), variant: "destructive" }),
    },
  });
  const deleteLink = useDeleteRecordLink({
    mutation: {
      onSuccess: () => invalidate(),
      onError: (err) => toast({ title: t("records.linkDeleteError", "Не удалось удалить связь"), description: extractError(err), variant: "destructive" }),
    },
  });

  const linkedIds = new Set(existingLinks.map((l) => l.record.id));
  const available = targetRecords.filter((r: EntityRecord) => !linkedIds.has(r.id));
  const busy = createLink.isPending || deleteLink.isPending;

  const handleAdd = () => {
    if (pick === PICK_PLACEHOLDER) return;
    createLink.mutate({ recordId, data: { relationId: relation.id, targetRecordId: Number(pick) } });
  };

  return (
    <div className="space-y-2 rounded-md border border-slate-100 p-3">
      <div className="text-sm font-medium text-slate-600">{ml(relation.nameJson)}</div>
      {linksLoading ? (
        <Skeleton className="h-6 w-full" />
      ) : existingLinks.length === 0 ? (
        <p className="text-xs text-slate-400">{t("records.noLinks", "Связанных записей нет.")}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {existingLinks.map((link) => (
            <span
              key={link.linkId}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 text-xs px-2 py-1"
            >
              {recordLabel(link.record)}
              <button
                type="button"
                className="hover:text-blue-900 disabled:opacity-50"
                disabled={busy}
                onClick={() => deleteLink.mutate({ id: link.linkId })}
                aria-label={t("records.deleteLink", "Удалить связь")}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Select value={pick} onValueChange={setPick} disabled={targetLoading || available.length === 0}>
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder={available.length === 0 ? t("records.noAvailable", "Нет доступных записей") : t("records.selectRecord", "Выберите запись")} />
          </SelectTrigger>
          <SelectContent>
            {available.map((r: EntityRecord) => (
              <SelectItem key={r.id} value={String(r.id)}>{recordLabel(r)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          disabled={pick === PICK_PLACEHOLDER || busy}
          onClick={handleAdd}
        >
          {createLink.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          {t("records.link", "Связать")}
        </Button>
      </div>
    </div>
  );
}
