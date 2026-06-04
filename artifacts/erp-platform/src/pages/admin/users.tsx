import { useState } from "react";
import {
  useListUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  useBlockUser,
  useUnblockUser,
  useResetUserPassword,
  useListRoles,
  type User,
  type UserInput,
  type UserUpdate,
  type MultilingualText,
  UserInputLanguage,
  UserInputDirection,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Search, UserPlus, Pencil, Trash2, Ban, CheckCircle, Key, Loader2
} from "lucide-react";

const LANG_LABELS: Record<string, string> = { ru: "RU", en: "EN", he: "HE" };

function getML(val: MultilingualText | string | undefined | null): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.ru || val.en || val.he || "";
}

function getInitials(firstName?: string, lastName?: string) {
  return `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "?";
}

interface FormState {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  roleId: number;
  language: UserInputLanguage;
  direction: UserInputDirection;
}

export default function UsersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [resetPwUser, setResetPwUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const [form, setForm] = useState<FormState>({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    roleId: 0,
    language: UserInputLanguage.ru,
    direction: UserInputDirection.ltr,
  });

  const { data: usersResult, isLoading } = useListUsers({ search: search || undefined });
  const { data: roles = [] } = useListRoles();

  const users: User[] = Array.isArray(usersResult)
    ? usersResult
    : (usersResult as { data?: User[] } | undefined)?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/users"] });

  const createMutation = useCreateUser({
    mutation: {
      onSuccess: () => { toast({ title: "Пользователь создан" }); setDialogOpen(false); invalidate(); },
      onError: (e: unknown) => toast({ title: "Ошибка", description: (e as { message?: string })?.message, variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateUser({
    mutation: {
      onSuccess: () => { toast({ title: "Пользователь обновлён" }); setDialogOpen(false); invalidate(); },
      onError: (e: unknown) => toast({ title: "Ошибка", description: (e as { message?: string })?.message, variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteUser({
    mutation: {
      onSuccess: () => { toast({ title: "Пользователь удалён" }); setDeleteUser(null); invalidate(); },
    },
  });

  const blockMutation = useBlockUser({ mutation: { onSuccess: () => { toast({ title: "Заблокирован" }); invalidate(); } } });
  const unblockMutation = useUnblockUser({ mutation: { onSuccess: () => { toast({ title: "Разблокирован" }); invalidate(); } } });
  const resetPwMutation = useResetUserPassword({
    mutation: {
      onSuccess: () => { toast({ title: "Пароль сброшен" }); setResetPwUser(null); setNewPassword(""); invalidate(); },
    },
  });

  const openCreate = () => {
    setEditingUser(null);
    setForm({ email: "", password: "", firstName: "", lastName: "", roleId: roles[0]?.id || 0, language: UserInputLanguage.ru, direction: UserInputDirection.ltr });
    setDialogOpen(true);
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setForm({
      email: user.email,
      password: "",
      firstName: user.firstName,
      lastName: user.lastName,
      roleId: user.roleId,
      language: (user.language as unknown as UserInputLanguage) || UserInputLanguage.ru,
      direction: (user.direction as unknown as UserInputDirection) || UserInputDirection.ltr,
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (editingUser) {
      const update: UserUpdate = {
        email: form.email,
        firstName: form.firstName,
        lastName: form.lastName,
        roleId: form.roleId,
        language: form.language as unknown as import("@workspace/api-client-react").UserUpdateLanguage,
        direction: form.direction as unknown as import("@workspace/api-client-react").UserUpdateDirection,
      };
      updateMutation.mutate({ id: editingUser.id, data: update });
    } else {
      const create: UserInput = {
        email: form.email,
        password: form.password,
        firstName: form.firstName,
        lastName: form.lastName,
        roleId: form.roleId,
        language: form.language,
        direction: form.direction,
      };
      createMutation.mutate({ data: create });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Пользователи</h1>
          <p className="text-sm text-slate-500 mt-0.5">Управление учётными записями</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <UserPlus className="w-4 h-4" />
          Создать
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder="Поиск по имени или email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Пользователь</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Роль</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Язык</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Статус</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Действия</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-5 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                      Пользователи не найдены
                    </td>
                  </tr>
                ) : (
                  users.map((user) => (
                    <tr key={user.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                            <span className="text-xs font-semibold text-white">
                              {getInitials(user.firstName, user.lastName)}
                            </span>
                          </div>
                          <span className="font-medium text-slate-700">
                            {user.firstName} {user.lastName}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{user.email}</td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="font-normal">
                          {getML(user.roleName) || "—"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {LANG_LABELS[user.language] || user.language}
                      </td>
                      <td className="px-4 py-3">
                        {user.isActive ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">Активен</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-600 border-0 font-normal">Заблокирован</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(user)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setResetPwUser(user); setNewPassword(""); }}>
                            <Key className="w-3.5 h-3.5" />
                          </Button>
                          {user.isActive ? (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-500" onClick={() => blockMutation.mutate({ id: user.id })}>
                              <Ban className="w-3.5 h-3.5" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-500" onClick={() => unblockMutation.mutate({ id: user.id })}>
                              <CheckCircle className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeleteUser(user)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Редактировать пользователя" : "Новый пользователь"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Имя *</Label>
                <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Фамилия *</Label>
                <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            {!editingUser && (
              <div className="space-y-1.5">
                <Label>Пароль *</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Роль *</Label>
              <Select value={String(form.roleId)} onValueChange={(v) => setForm({ ...form, roleId: Number(v) })}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите роль" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {getML(r.nameJson) || "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Язык</Label>
                <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v as UserInputLanguage })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ru">Русский</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="he">עברית</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Направление</Label>
                <Select value={form.direction} onValueChange={(v) => setForm({ ...form, direction: v as UserInputDirection })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ltr">LTR</SelectItem>
                    <SelectItem value="rtl">RTL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingUser ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteUser} onOpenChange={(o) => !o && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
            <AlertDialogDescription>
              Пользователь {deleteUser?.firstName} {deleteUser?.lastName} будет удалён без возможности восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteUser && deleteMutation.mutate({ id: deleteUser.id })}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!resetPwUser} onOpenChange={(o) => !o && setResetPwUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Сброс пароля</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-500">
              Введите новый пароль для {resetPwUser?.firstName} {resetPwUser?.lastName}
            </p>
            <Input
              type="password"
              placeholder="Новый пароль"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwUser(null)}>Отмена</Button>
            <Button
              onClick={() => resetPwUser && resetPwMutation.mutate({ id: resetPwUser.id, data: { newPassword } })}
              disabled={!newPassword || resetPwMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {resetPwMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Сбросить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
