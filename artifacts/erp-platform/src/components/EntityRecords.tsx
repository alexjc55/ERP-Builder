import { useState } from "react";
import {
  useListEntityRecords,
  useCreateEntityRecord,
  useUpdateRecord,
  useDeleteRecord,
  useListEntityFields,
  useListEntityStatuses,
  type EntityRecord,
  type Field,
  type Status,
  type MultilingualText,
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
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, Inbox } from "lucide-react";

const NO_STATUS = "__none__";

function getML(val: MultilingualText | string | undefined | null): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.ru || val.en || val.he || "";
}

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

function renderCellValue(field: Field, value: unknown): React.ReactNode {
  if (value === undefined || value === null || value === "") return <span className="text-slate-300">—</span>;
  if (field.fieldType === "boolean") {
    return value ? (
      <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">Да</Badge>
    ) : (
      <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">Нет</Badge>
    );
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
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: allFields = [], isLoading: fieldsLoading } = useListEntityFields(entityId);
  const { data: statuses = [] } = useListEntityStatuses(entityId);
  const { data: records = [], isLoading: recordsLoading } = useListEntityRecords(entityId);

  const fields = [...allFields]
    .filter((f: Field) => f.isActive)
    .sort((a: Field, b: Field) => a.sortOrder - b.sortOrder);
  const statusById = new Map(statuses.map((s: Status) => [s.id, s]));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [toDelete, setToDelete] = useState<EntityRecord | null>(null);
  const [form, setForm] = useState<FormState>({});
  const [statusId, setStatusId] = useState<string>(NO_STATUS);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/records`] });

  const createMutation = useCreateEntityRecord({
    mutation: {
      onSuccess: () => { toast({ title: "Запись создана" }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: "Ошибка создания записи", description: extractError(err), variant: "destructive" }),
    },
  });
  const updateMutation = useUpdateRecord({
    mutation: {
      onSuccess: () => { toast({ title: "Запись обновлена" }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: "Ошибка обновления", description: extractError(err), variant: "destructive" }),
    },
  });
  const deleteMutation = useDeleteRecord({
    mutation: {
      onSuccess: () => { toast({ title: "Запись удалена" }); setToDelete(null); invalidate(); },
      onError: () => toast({ title: "Ошибка удаления записи", variant: "destructive" }),
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
    const valuesJson = formToValues(fields, form);
    const statusValue = statusId === NO_STATUS ? null : Number(statusId);
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: { valuesJson, statusId: statusValue } });
    } else {
      createMutation.mutate({ entityId, data: { valuesJson, statusId: statusValue } });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const displayFields = fields.slice(0, 5);

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
          <p className="text-slate-700 font-medium">У этой сущности ещё нет полей</p>
          <p className="text-sm text-slate-400 max-w-md">
            Сначала настройте поля в конструкторе полей — без них нельзя создавать записи.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          Добавить запись
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {recordsLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : records.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              Записей пока нет. Нажмите «Добавить запись», чтобы создать первую.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50">
                    {displayFields.map((f: Field) => (
                      <th key={f.id} className="text-left px-4 py-3 font-medium text-slate-600 whitespace-nowrap">
                        {getML(f.nameJson)}
                      </th>
                    ))}
                    {statuses.length > 0 && (
                      <th className="text-left px-4 py-3 font-medium text-slate-600">Статус</th>
                    )}
                    <th className="text-right px-4 py-3 font-medium text-slate-600">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record: EntityRecord) => {
                    const values = (record.valuesJson ?? {}) as Record<string, unknown>;
                    const status = record.statusId != null ? statusById.get(record.statusId) : undefined;
                    return (
                      <tr key={record.id} className="border-b border-slate-100 hover:bg-slate-50">
                        {displayFields.map((f: Field) => (
                          <td key={f.id} className="px-4 py-3 max-w-[240px] truncate">
                            {renderCellValue(f, values[f.fieldKey])}
                          </td>
                        ))}
                        {statuses.length > 0 && (
                          <td className="px-4 py-3">
                            {status ? (
                              <span
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                                style={{ backgroundColor: `${status.color}20`, color: status.color }}
                              >
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: status.color }} />
                                {getML(status.nameJson)}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(record)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setToDelete(record)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать запись" : "Новая запись"}</DialogTitle>
            <DialogDescription>
              Заполните поля записи. Обязательные поля помечены звёздочкой.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {fields.map((field: Field) => (
              <div key={field.id} className="space-y-1.5">
                <Label>
                  {getML(field.nameJson)}
                  {field.isRequired && <span className="text-red-500 ml-0.5">*</span>}
                </Label>
                <FieldInput
                  field={field}
                  value={form[field.fieldKey]}
                  onChange={(v) => setForm((prev) => ({ ...prev, [field.fieldKey]: v }))}
                />
                {getML(field.descriptionJson) && (
                  <p className="text-xs text-slate-400">{getML(field.descriptionJson)}</p>
                )}
              </div>
            ))}

            {statuses.length > 0 && (
              <div className="space-y-1.5">
                <Label>Статус</Label>
                <Select value={statusId} onValueChange={setStatusId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Без статуса" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_STATUS}>Без статуса</SelectItem>
                    {statuses.map((s: Status) => (
                      <SelectItem key={s.id} value={String(s.id)}>
                        {getML(s.nameJson)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить запись?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись будет удалена безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => toDelete && deleteMutation.mutate({ id: toDelete.id })}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  switch (field.fieldType) {
    case "textarea":
      return <Textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "boolean":
      return (
        <div className="flex items-center gap-2">
          <Switch checked={Boolean(value)} onCheckedChange={onChange} />
          <span className="text-sm text-slate-500">{value ? "Да" : "Нет"}</span>
        </div>
      );
    case "number":
      return (
        <Input
          type="number"
          value={value === "" || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "date":
      return <Input type="date" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "datetime":
      return <Input type="datetime-local" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "email":
      return <Input type="email" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "url":
      return <Input type="url" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder="https://" />;
    case "phone":
      return <Input type="tel" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
    case "select": {
      const options = Array.isArray(field.optionsJson) ? (field.optionsJson as string[]) : [];
      return (
        <Select value={value ? String(value) : ""} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="Выберите значение" />
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
      return <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}
