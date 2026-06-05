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
  useListGuestLinks,
  useCreateGuestLink,
  useRevokeGuestLink,
  type User,
  type UserInput,
  type UserUpdate,
  type GuestLink,
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
  Search, UserPlus, Pencil, Trash2, Ban, CheckCircle, Key, Loader2, LogIn,
  Link2, Copy, Check as CheckIcon
} from "lucide-react";
import { useML, useT } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";

const LANG_LABELS: Record<string, string> = { ru: "RU", en: "EN", he: "HE" };

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
  isGuest: boolean;
}

export default function UsersPage() {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [deleteUser, setDeleteUser] = useState<User | null>(null);
  const [resetPwUser, setResetPwUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [linksUser, setLinksUser] = useState<User | null>(null);
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [createdLink, setCreatedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState<FormState>({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    roleId: 0,
    language: UserInputLanguage.ru,
    direction: UserInputDirection.ltr,
    isGuest: false,
  });

  const { user: currentUser, isSuperAdmin, canAdmin, impersonate } = useAuth();
  const canImpersonate = isSuperAdmin || canAdmin("users");

  const { data: usersResult, isLoading } = useListUsers({ search: search || undefined });
  const { data: roles = [] } = useListRoles();

  const superRoleIds = new Set(roles.filter((r) => r.permissionsJson?.superAdmin).map((r) => r.id));
  const canImpersonateUser = (u: User) =>
    canImpersonate && u.id !== currentUser?.id && (isSuperAdmin || !superRoleIds.has(u.roleId));

  const users: User[] = Array.isArray(usersResult)
    ? usersResult
    : (usersResult as { data?: User[] } | undefined)?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/users"] });

  const createMutation = useCreateUser({
    mutation: {
      onSuccess: () => { toast({ title: t("users.created", "Пользователь создан") }); setDialogOpen(false); invalidate(); },
      onError: (e: unknown) => toast({ title: t("users.error", "Ошибка"), description: (e as { message?: string })?.message, variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateUser({
    mutation: {
      onSuccess: () => { toast({ title: t("users.updated", "Пользователь обновлён") }); setDialogOpen(false); invalidate(); },
      onError: (e: unknown) => toast({ title: t("users.error", "Ошибка"), description: (e as { message?: string })?.message, variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteUser({
    mutation: {
      onSuccess: () => { toast({ title: t("users.deleted", "Пользователь удалён") }); setDeleteUser(null); invalidate(); },
    },
  });

  const blockMutation = useBlockUser({ mutation: { onSuccess: () => { toast({ title: t("users.blocked", "Заблокирован") }); invalidate(); } } });
  const unblockMutation = useUnblockUser({ mutation: { onSuccess: () => { toast({ title: t("users.unblocked", "Разблокирован") }); invalidate(); } } });
  const resetPwMutation = useResetUserPassword({
    mutation: {
      onSuccess: () => { toast({ title: t("users.passwordReset", "Пароль сброшен") }); setResetPwUser(null); setNewPassword(""); invalidate(); },
    },
  });

  const openCreate = () => {
    setEditingUser(null);
    setForm({ email: "", password: "", firstName: "", lastName: "", roleId: roles[0]?.id || 0, language: UserInputLanguage.ru, direction: UserInputDirection.ltr, isGuest: false });
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
      isGuest: false,
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
        // A guest user is passwordless: omit the password entirely so the server
        // stores a null hash. They can only enter via a guest link (read-only).
        password: form.isGuest ? null : form.password,
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
          <h1 className="text-2xl font-bold text-slate-800">{t("users.title", "Пользователи")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t("users.subtitle", "Управление учётными записями")}</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <UserPlus className="w-4 h-4" />
          {t("users.create", "Создать")}
        </Button>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <Input
          placeholder={t("users.searchPlaceholder", "Поиск по имени или email...")}
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
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("users.colUser", "Пользователь")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Email</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("users.colRole", "Роль")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("users.colLanguage", "Язык")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("users.colStatus", "Статус")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">{t("users.colActions", "Действия")}</th>
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
                      {t("users.empty", "Пользователи не найдены")}
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
                          {ml(user.roleName) || "—"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {LANG_LABELS[user.language] || user.language}
                      </td>
                      <td className="px-4 py-3">
                        {user.isActive ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">{t("users.active", "Активен")}</Badge>
                        ) : (
                          <Badge className="bg-red-100 text-red-600 border-0 font-normal">{t("users.blocked", "Заблокирован")}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {canImpersonateUser(user) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-blue-600"
                              title={t("users.impersonate", "Войти под пользователем")}
                              onClick={() => {
                                impersonate(user.id).catch(() =>
                                  toast({
                                    title: t("users.impersonateError", "Не удалось войти под пользователем"),
                                    variant: "destructive",
                                  })
                                );
                              }}
                            >
                              <LogIn className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-sky-600"
                            title={t("users.guestLinks", "Гостевые ссылки")}
                            onClick={() => { setLinksUser(user); setNewLinkLabel(""); setCreatedLink(null); }}
                          >
                            <Link2 className="w-3.5 h-3.5" />
                          </Button>
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
            <DialogTitle>{editingUser ? t("users.editTitle", "Редактировать пользователя") : t("users.newTitle", "Новый пользователь")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("users.firstName", "Имя")} *</Label>
                <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("users.lastName", "Фамилия")} *</Label>
                <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            {!editingUser && (
              <div className="rounded-md border border-sky-200 bg-sky-50/60 p-3 space-y-2">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.isGuest}
                    onChange={(e) => setForm({ ...form, isGuest: e.target.checked })}
                  />
                  <span className="text-sm">
                    <span className="font-medium text-sky-900">{t("users.guestUser", "Гостевой доступ (без пароля)")}</span>
                    <span className="block text-xs text-sky-700">
                      {t("users.guestUserHint", "Вход только по ссылке, режим только для чтения. Назначьте роль «Гость».")}
                    </span>
                  </span>
                </label>
              </div>
            )}
            {!editingUser && !form.isGuest && (
              <div className="space-y-1.5">
                <Label>{t("users.password", "Пароль")} *</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>{t("users.colRole", "Роль")} *</Label>
              <Select value={String(form.roleId)} onValueChange={(v) => setForm({ ...form, roleId: Number(v) })}>
                <SelectTrigger>
                  <SelectValue placeholder={t("users.selectRole", "Выберите роль")} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {ml(r.nameJson) || "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("users.colLanguage", "Язык")}</Label>
                <Select value={form.language} onValueChange={(v) => setForm({ ...form, language: v as UserInputLanguage })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ru">{t("users.langRussian", "Русский")}</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="he">עברית</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("users.direction", "Направление")}</Label>
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
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("users.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingUser ? t("users.save", "Сохранить") : t("users.create", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteUser} onOpenChange={(o) => !o && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("users.deleteTitle", "Удалить пользователя?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("users.deleteConfirmPrefix", "Пользователь")} {deleteUser?.firstName} {deleteUser?.lastName} {t("users.deleteConfirmSuffix", "будет удалён без возможности восстановления.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("users.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteUser && deleteMutation.mutate({ id: deleteUser.id })}
            >
              {t("users.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!resetPwUser} onOpenChange={(o) => !o && setResetPwUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("users.resetPwTitle", "Сброс пароля")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-500">
              {t("users.resetPwPrompt", "Введите новый пароль для")} {resetPwUser?.firstName} {resetPwUser?.lastName}
            </p>
            <Input
              type="password"
              placeholder={t("users.newPasswordPlaceholder", "Новый пароль")}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPwUser(null)}>{t("users.cancel", "Отмена")}</Button>
            <Button
              onClick={() => resetPwUser && resetPwMutation.mutate({ id: resetPwUser.id, data: { newPassword } })}
              disabled={!newPassword || resetPwMutation.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {resetPwMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : t("users.reset", "Сбросить")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!linksUser} onOpenChange={(o) => { if (!o) { setLinksUser(null); setCreatedLink(null); setNewLinkLabel(""); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("users.guestLinksTitle", "Гостевые ссылки")}
              {linksUser ? ` — ${linksUser.firstName} ${linksUser.lastName}` : ""}
            </DialogTitle>
          </DialogHeader>
          {linksUser && (
            <GuestLinksManager
              key={linksUser.id}
              userId={linksUser.id}
              newLinkLabel={newLinkLabel}
              setNewLinkLabel={setNewLinkLabel}
              createdLink={createdLink}
              setCreatedLink={setCreatedLink}
              copied={copied}
              setCopied={setCopied}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function GuestLinksManager({
  userId,
  newLinkLabel,
  setNewLinkLabel,
  createdLink,
  setCreatedLink,
  copied,
  setCopied,
}: {
  userId: number;
  newLinkLabel: string;
  setNewLinkLabel: (v: string) => void;
  createdLink: string | null;
  setCreatedLink: (v: string | null) => void;
  copied: boolean;
  setCopied: (v: boolean) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const { data: links = [], isLoading, refetch } = useListGuestLinks(userId);

  const createMutation = useCreateGuestLink({
    mutation: {
      onSuccess: (data) => {
        setCreatedLink(data.url);
        setNewLinkLabel("");
        refetch();
      },
      onError: (e: unknown) =>
        toast({ title: t("users.error", "Ошибка"), description: (e as { message?: string })?.message, variant: "destructive" }),
    },
  });

  const revokeMutation = useRevokeGuestLink({
    mutation: {
      onSuccess: () => { toast({ title: t("users.linkRevoked", "Ссылка отозвана") }); refetch(); },
    },
  });

  const copy = (url: string) => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("ru-RU") : "—");

  return (
    <div className="space-y-4 py-1">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label>{t("users.linkLabel", "Название (необязательно)")}</Label>
          <Input
            placeholder={t("users.linkLabelPlaceholder", "Напр. Клиент Иванов")}
            value={newLinkLabel}
            onChange={(e) => setNewLinkLabel(e.target.value)}
          />
        </div>
        <Button
          className="bg-blue-600 hover:bg-blue-700 gap-2"
          disabled={createMutation.isPending}
          onClick={() => createMutation.mutate({ id: userId, data: { label: newLinkLabel || null } })}
        >
          {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
          {t("users.generateLink", "Создать ссылку")}
        </Button>
      </div>

      {createdLink && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 space-y-2">
          <p className="text-xs text-emerald-800">
            {t("users.linkCreatedHint", "Скопируйте ссылку сейчас — позже она не будет показана:")}
          </p>
          <div className="flex items-center gap-2">
            <Input readOnly value={createdLink} className="text-xs bg-white" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" size="icon" className="shrink-0" onClick={() => copy(createdLink)}>
              {copied ? <CheckIcon className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      )}

      <div className="border rounded-md divide-y">
        {isLoading ? (
          <div className="p-4 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : links.length === 0 ? (
          <div className="p-4 text-center text-sm text-slate-400">{t("users.noLinks", "Ссылок пока нет")}</div>
        ) : (
          links.map((link: GuestLink) => (
            <div key={link.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium text-slate-700 truncate">
                  {link.label || t("users.unnamedLink", "Без названия")}
                </div>
                <div className="text-xs text-slate-400">
                  {t("users.linkCreated", "Создана")}: {fmt(link.createdAt)}
                  {link.lastUsedAt ? ` · ${t("users.linkLastUsed", "Использована")}: ${fmt(link.lastUsedAt)}` : ""}
                  {link.expiresAt ? ` · ${t("users.linkExpires", "Истекает")}: ${fmt(link.expiresAt)}` : ""}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {link.isActive ? (
                  <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">{t("users.linkActive", "Активна")}</Badge>
                ) : link.revokedAt ? (
                  <Badge className="bg-red-100 text-red-600 border-0 font-normal">{t("users.linkRevokedBadge", "Отозвана")}</Badge>
                ) : (
                  <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">{t("users.linkExpired", "Истекла")}</Badge>
                )}
                {link.isActive && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-red-500"
                    title={t("users.revokeLink", "Отозвать")}
                    disabled={revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate({ id: link.id })}
                  >
                    <Ban className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
