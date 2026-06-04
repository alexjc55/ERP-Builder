import { useState } from "react";
import {
  useListRoles,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  type Role,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import { Plus, Pencil, Trash2, Shield, Loader2, Users } from "lucide-react";

type MLValue = { ru?: string; en?: string; he?: string };

export default function RolesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [deleteRole, setDeleteRole] = useState<Role | null>(null);
  const [nameJson, setNameJson] = useState<MLValue>({ ru: "", en: "", he: "" });
  const [descJson, setDescJson] = useState<MLValue>({ ru: "", en: "", he: "" });

  const { data: roles = [], isLoading } = useListRoles();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/roles"] });

  const createMutation = useCreateRole({
    mutation: {
      onSuccess: () => { toast({ title: "Роль создана" }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: "Ошибка создания роли", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateRole({
    mutation: {
      onSuccess: () => { toast({ title: "Роль обновлена" }); setDialogOpen(false); invalidate(); },
    },
  });

  const deleteMutation = useDeleteRole({
    mutation: {
      onSuccess: () => { toast({ title: "Роль удалена" }); setDeleteRole(null); invalidate(); },
      onError: () => toast({ title: "Нельзя удалить роль с пользователями", variant: "destructive" }),
    },
  });

  const openCreate = () => {
    setEditingRole(null);
    setNameJson({ ru: "", en: "", he: "" });
    setDescJson({ ru: "", en: "", he: "" });
    setDialogOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditingRole(role);
    setNameJson(role.nameJson || {});
    setDescJson(role.descriptionJson || {});
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = {
      nameJson: nameJson as Record<string, string>,
      descriptionJson: descJson as Record<string, string>,
    };
    if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Роли</h1>
          <p className="text-sm text-slate-500 mt-0.5">Управление ролями и правами доступа</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          Создать роль
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-slate-200">
              <CardContent className="p-5">
                <Skeleton className="h-6 w-32 mb-2" />
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : roles.length === 0 ? (
        <div className="text-center py-16 text-slate-400">Роли не найдены</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {roles.map((role) => (
            <Card key={role.id} className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                      <Shield className="w-5 h-5 text-violet-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800 text-sm leading-tight">
                        {role.nameJson?.["ru"] || role.nameJson?.["en"] || "—"}
                      </h3>
                      {role.nameJson?.["en"] && (
                        <span className="text-xs text-slate-400">{role.nameJson["en"]}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(role)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => setDeleteRole(role)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {role.descriptionJson?.["ru"] && (
                  <p className="text-xs text-slate-500 mt-3 line-clamp-2">
                    {role.descriptionJson["ru"]}
                  </p>
                )}

                {role.userCount !== undefined && (
                  <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs text-slate-500">{role.userCount} пользователей</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingRole ? "Редактировать роль" : "Новая роль"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput
              label="Название"
              value={nameJson}
              onChange={setNameJson}
              required
            />
            <MultilingualInput
              label="Описание"
              value={descJson}
              onChange={setDescJson}
              multiline
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingRole ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRole} onOpenChange={(o) => !o && setDeleteRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить роль?</AlertDialogTitle>
            <AlertDialogDescription>
              Роль "{deleteRole?.nameJson?.["ru"] || deleteRole?.nameJson?.["en"]}" будет удалена.
              Убедитесь, что нет пользователей с этой ролью.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteRole && deleteMutation.mutate({ id: deleteRole.id })}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
