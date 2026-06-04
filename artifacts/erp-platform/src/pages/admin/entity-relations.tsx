import { useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useListEntityRelations,
  useCreateEntityRelation,
  useUpdateRelation,
  useDeleteRelation,
  useListEntities,
  type Relation,
  type RelationType,
  type Entity,
  type MultilingualText,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { MultilingualInput } from "@/components/MultilingualInput";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Loader2, ArrowLeft, Share2, ArrowRight } from "lucide-react";

type MLValue = { ru?: string; en?: string; he?: string };

const RELATION_TYPES: { value: RelationType; label: string; hint: string }[] = [
  { value: "one_to_one", label: "Один к одному (1:1)", hint: "Одна запись источника связана максимум с одной записью цели и наоборот." },
  { value: "one_to_many", label: "Один ко многим (1:N)", hint: "Одна запись источника связана с несколькими записями цели; каждая цель — с одним источником." },
  { value: "many_to_one", label: "Многие к одному (N:1)", hint: "Несколько записей источника указывают на одну запись цели." },
  { value: "many_to_many", label: "Многие ко многим (N:N)", hint: "Любая запись источника связана с любым числом записей цели." },
];

function relationTypeLabel(t: RelationType): string {
  return RELATION_TYPES.find((r) => r.value === t)?.label ?? t;
}

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

export default function EntityRelationsPage() {
  const params = useParams();
  const entityId = Number(params.entityId);
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Relation | null>(null);
  const [toDelete, setToDelete] = useState<Relation | null>(null);

  const [relationKey, setRelationKey] = useState("");
  const [targetEntityId, setTargetEntityId] = useState<string>("");
  const [relationType, setRelationType] = useState<RelationType>("one_to_many");
  const [nameJson, setNameJson] = useState<MLValue>({});
  const [inverseNameJson, setInverseNameJson] = useState<MLValue>({});

  const { data: entities = [] } = useListEntities();
  const entity = entities.find((e: Entity) => e.id === entityId);
  const entityById = new Map(entities.map((e: Entity) => [e.id, e]));

  const { data: relations = [], isLoading } = useListEntityRelations(entityId);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/entities/${entityId}/relations`] });

  const createMutation = useCreateEntityRelation({
    mutation: {
      onSuccess: () => { toast({ title: "Связь создана" }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: "Ошибка создания связи", description: extractError(err), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateRelation({
    mutation: {
      onSuccess: () => { toast({ title: "Связь обновлена" }); setDialogOpen(false); invalidate(); },
      onError: (err) => toast({ title: "Ошибка обновления", description: extractError(err), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteRelation({
    mutation: {
      onSuccess: () => { toast({ title: "Связь удалена" }); setToDelete(null); invalidate(); },
      onError: (err) => toast({ title: "Ошибка удаления связи", description: extractError(err), variant: "destructive" }),
    },
  });

  const openCreate = () => {
    setEditing(null);
    setRelationKey("");
    setTargetEntityId("");
    setRelationType("one_to_many");
    setNameJson({});
    setInverseNameJson({});
    setDialogOpen(true);
  };

  const openEdit = (relation: Relation) => {
    setEditing(relation);
    setRelationKey(relation.relationKey);
    setTargetEntityId(String(relation.targetEntityId));
    setRelationType(relation.relationType);
    const n = relation.nameJson;
    setNameJson(typeof n === "object" && n ? { ru: n.ru, en: n.en, he: n.he } : {});
    const inv = relation.inverseNameJson;
    setInverseNameJson(typeof inv === "object" && inv ? { ru: inv.ru, en: inv.en, he: inv.he } : {});
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (editing) {
      updateMutation.mutate({
        id: editing.id,
        data: {
          relationKey: relationKey.trim(),
          relationType,
          nameJson: nameJson as MultilingualText,
          inverseNameJson: inverseNameJson as MultilingualText,
        },
      });
    } else {
      if (!targetEntityId) {
        toast({ title: "Выберите целевую сущность", variant: "destructive" });
        return;
      }
      createMutation.mutate({
        entityId,
        data: {
          targetEntityId: Number(targetEntityId),
          relationKey: relationKey.trim(),
          relationType,
          nameJson: nameJson as MultilingualText,
          inverseNameJson: inverseNameJson as MultilingualText,
        },
      });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          onClick={() => navigate("/admin/entities")}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          К списку сущностей
        </button>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
              <Share2 className="w-6 h-6 text-blue-600" />
              Связи{entity ? `: ${getML(entity.nameJson)}` : ""}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Связи между сущностями: как записи этой сущности соотносятся с записями других{entity ? <> <code className="text-xs">{entity.entityKey}</code></> : null}
            </p>
          </div>
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
            <Plus className="w-4 h-4" />
            Добавить связь
          </Button>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : relations.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              У этой сущности ещё нет связей. Нажмите «Добавить связь», чтобы создать первую.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Название</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Ключ</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Цель</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Тип</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Действия</th>
                </tr>
              </thead>
              <tbody>
                {relations.map((relation: Relation) => {
                  const target = entityById.get(relation.targetEntityId);
                  return (
                    <tr key={relation.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-700">{getML(relation.nameJson)}</td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{relation.relationKey}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 text-slate-600">
                          <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                          {target ? getML(target.nameJson) : <span className="text-slate-300">—</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge className="bg-blue-100 text-blue-700 border-0 font-normal">
                          {relationTypeLabel(relation.relationType)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(relation)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setToDelete(relation)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать связь" : "Новая связь"}</DialogTitle>
            <DialogDescription>
              Связь описывает, как записи этой сущности соотносятся с записями целевой сущности.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label="Название" value={nameJson} onChange={setNameJson} required />
            <div className="space-y-1.5">
              <Label>Системный ключ</Label>
              <Input
                value={relationKey}
                onChange={(e) => setRelationKey(e.target.value)}
                placeholder="orders"
                className="font-mono"
              />
              <p className="text-xs text-slate-400">
                Только строчные латинские буквы, цифры и подчёркивания (например, <code>orders</code>). Уникален в пределах сущности.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Целевая сущность</Label>
              <Select
                value={targetEntityId}
                onValueChange={setTargetEntityId}
                disabled={!!editing}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите сущность" />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((e: Entity) => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      {getML(e.nameJson)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editing && (
                <p className="text-xs text-slate-400">Целевую сущность нельзя изменить после создания.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Тип связи</Label>
              <Select value={relationType} onValueChange={(v) => setRelationType(v as RelationType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATION_TYPES.map((rt) => (
                    <SelectItem key={rt.value} value={rt.value}>{rt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400">
                {RELATION_TYPES.find((rt) => rt.value === relationType)?.hint}
              </p>
            </div>
            <div className="space-y-1.5">
              <MultilingualInput label="Обратное название (необязательно)" value={inverseNameJson} onChange={setInverseNameJson} />
              <p className="text-xs text-slate-400">Как связь выглядит со стороны целевой сущности (например, «Проект»).</p>
            </div>
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
            <AlertDialogTitle>Удалить связь?</AlertDialogTitle>
            <AlertDialogDescription>
              "{getML(toDelete?.nameJson)}" будет удалена вместе со всеми связями записей.
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
