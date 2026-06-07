import { useState } from "react";
import {
  useListRoles,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useListPages,
  useListEntities,
  useListEntityFields,
  type Role,
  type RolePermissions,
  type RoleAdminCaps,
  type RecordPermission,
  type RecordScope,
  type Page,
  type Entity,
  type Field,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Plus, Pencil, Trash2, Shield, Loader2, Users, Crown } from "lucide-react";
import { adminCapForPath } from "@/lib/permissions";
import { useML, useT } from "@/lib/i18n";

type MLValue = { ru?: string; en?: string; he?: string };

function emptyPerms(): RolePermissions {
  return {
    superAdmin: false,
    admin: { pages: false, entities: false, roles: false, users: false, translations: false, events: false, modules: false, googleDrive: false, settings: false },
    pageIds: [],
    records: {},
  };
}

const ADMIN_CAP_LABELS: { key: keyof RoleAdminCaps; label: string }[] = [
  { key: "pages", label: "Страницы" },
  { key: "entities", label: "Сущности (поля, статусы, связи, виды)" },
  { key: "roles", label: "Роли" },
  { key: "users", label: "Пользователи" },
  { key: "translations", label: "Переводы" },
  { key: "events", label: "События" },
  { key: "modules", label: "Модули" },
  { key: "googleDrive", label: "Google Drive" },
  { key: "settings", label: "Настройки платформы (брендинг)" },
];

const RECORD_ACTIONS: { key: keyof RecordPermission; label: string }[] = [
  { key: "view", label: "Просмотр" },
  { key: "create", label: "Создание" },
  { key: "update", label: "Изменение" },
  { key: "delete", label: "Удаление" },
];

export default function RolesPage() {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [deleteRole, setDeleteRole] = useState<Role | null>(null);
  const [nameJson, setNameJson] = useState<MLValue>({ ru: "", en: "", he: "" });
  const [descJson, setDescJson] = useState<MLValue>({ ru: "", en: "", he: "" });
  const [perms, setPerms] = useState<RolePermissions>(emptyPerms());

  const { data: roles = [], isLoading } = useListRoles();
  const { data: pages = [] } = useListPages();
  const { data: entities = [] } = useListEntities();

  // Content pages (everything not under /admin/*) are gated individually by id.
  const contentPages = pages.filter(
    (p: Page) => p.isActive && !(p.path || "").startsWith("/admin/") && (p.path || "") !== "/",
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/roles"] });

  const createMutation = useCreateRole({
    mutation: {
      onSuccess: () => { toast({ title: t("roles.created", "Роль создана") }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: t("roles.createError", "Ошибка создания роли"), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateRole({
    mutation: {
      onSuccess: () => { toast({ title: t("roles.updated", "Роль обновлена") }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: t("roles.updateError", "Ошибка обновления роли"), variant: "destructive" }),
    },
  });

  const deleteMutation = useDeleteRole({
    mutation: {
      onSuccess: () => { toast({ title: t("roles.deleted", "Роль удалена") }); setDeleteRole(null); invalidate(); },
      onError: () => toast({ title: t("roles.deleteUsersError", "Нельзя удалить роль с пользователями"), variant: "destructive" }),
    },
  });

  const openCreate = () => {
    setEditingRole(null);
    setNameJson({ ru: "", en: "", he: "" });
    setDescJson({ ru: "", en: "", he: "" });
    setPerms(emptyPerms());
    setDialogOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditingRole(role);
    setNameJson(role.nameJson || {});
    setDescJson(role.descriptionJson || {});
    const base = emptyPerms();
    const p = role.permissionsJson;
    setPerms(
      p
        ? {
            superAdmin: p.superAdmin ?? false,
            admin: { ...base.admin, ...(p.admin ?? {}) },
            pageIds: p.pageIds ?? [],
            records: p.records ?? {},
          }
        : base,
    );
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = {
      nameJson: nameJson as Record<string, string>,
      descriptionJson: descJson as Record<string, string>,
      permissionsJson: perms,
    };
    if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const locked = perms.superAdmin;

  const toggleAdminCap = (key: keyof RoleAdminCaps, checked: boolean) =>
    setPerms((prev) => ({ ...prev, admin: { ...prev.admin, [key]: checked } }));

  const togglePage = (pageId: number, checked: boolean) =>
    setPerms((prev) => ({
      ...prev,
      pageIds: checked ? [...prev.pageIds, pageId] : prev.pageIds.filter((id) => id !== pageId),
    }));

  const toggleRecord = (entityId: number, action: keyof RecordPermission, checked: boolean) =>
    setPerms((prev) => {
      const current: RecordPermission =
        prev.records[String(entityId)] ?? { view: false, create: false, update: false, delete: false };
      const next: RecordPermission = { ...current, [action]: checked };
      // Any write implies view; turning off view clears all writes.
      if (checked && action !== "view") next.view = true;
      if (action === "view" && !checked) {
        next.create = false;
        next.update = false;
        next.delete = false;
      }
      return { ...prev, records: { ...prev.records, [String(entityId)]: next } };
    });

  const getRecordPerm = (entityId: number): RecordPermission =>
    perms.records[String(entityId)] ?? { view: false, create: false, update: false, delete: false };

  const setScope = (entityId: number, scope: RecordScope) =>
    setPerms((prev) => {
      const current: RecordPermission =
        prev.records[String(entityId)] ?? { view: false, create: false, update: false, delete: false };
      return { ...prev, records: { ...prev.records, [String(entityId)]: { ...current, scope } } };
    });

  const toggleScopeFieldKey = (entityId: number, key: string, checked: boolean) =>
    setPerms((prev) => {
      const current: RecordPermission =
        prev.records[String(entityId)] ?? { view: false, create: false, update: false, delete: false };
      const keys = current.scopeFieldKeys ?? [];
      const next = checked ? [...keys, key] : keys.filter((k) => k !== key);
      return { ...prev, records: { ...prev.records, [String(entityId)]: { ...current, scopeFieldKeys: next } } };
    });

  const scopedEntities = entities.filter((e: Entity) => getRecordPerm(e.id).view);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("roles.title", "Роли")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t("roles.subtitle", "Управление ролями и правами доступа")}</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          {t("roles.create", "Создать роль")}
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
        <div className="text-center py-16 text-slate-400">{t("roles.empty", "Роли не найдены")}</div>
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

                {role.permissionsJson?.superAdmin && (
                  <div className="inline-flex items-center gap-1.5 mt-3 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                    <Crown className="w-3 h-3" />
                    {t("roles.fullAccess", "Полный доступ")}
                  </div>
                )}

                {role.descriptionJson?.["ru"] && (
                  <p className="text-xs text-slate-500 mt-3 line-clamp-2">
                    {role.descriptionJson["ru"]}
                  </p>
                )}

                {role.userCount !== undefined && (
                  <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-slate-100">
                    <Users className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-xs text-slate-500">{role.userCount} {t("roles.usersCount", "пользователей")}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRole ? t("roles.editTitle", "Редактировать роль") : t("roles.newTitle", "Новая роль")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 py-2">
            <MultilingualInput
              label={t("roles.name", "Название")}
              value={nameJson}
              onChange={setNameJson}
              required
            />
            <MultilingualInput
              label={t("roles.description", "Описание")}
              value={descJson}
              onChange={setDescJson}
              multiline
            />

            <div className="border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between gap-4 rounded-lg bg-amber-50 border border-amber-100 p-3">
                <div className="flex items-center gap-2.5">
                  <Crown className="w-5 h-5 text-amber-600" />
                  <div>
                    <p className="text-sm font-medium text-slate-800">{t("roles.superAdmin", "Полный доступ (суперадмин)")}</p>
                    <p className="text-xs text-slate-500">{t("roles.superAdminDesc", "Все права во всех разделах. Остальные настройки игнорируются.")}</p>
                  </div>
                </div>
                <Switch
                  checked={perms.superAdmin}
                  onCheckedChange={(v) => setPerms((prev) => ({ ...prev, superAdmin: v }))}
                />
              </div>
            </div>

            <div className={locked ? "opacity-40 pointer-events-none space-y-5" : "space-y-5"}>
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-2">{t("roles.adminSections", "Разделы администрирования")}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {ADMIN_CAP_LABELS.map(({ key, label }) => (
                    <label key={key} className="flex items-center gap-2.5 rounded-md border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50">
                      <Checkbox
                        checked={perms.admin[key]}
                        onCheckedChange={(v) => toggleAdminCap(key, v === true)}
                      />
                      <span className="text-sm text-slate-700">{t(`roles.cap.${key}`, label)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-2">{t("roles.pageAccess", "Доступ к страницам")}</h4>
                {contentPages.length === 0 ? (
                  <p className="text-xs text-slate-400">{t("roles.noContentPages", "Нет контентных страниц.")}</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {contentPages.map((page: Page) => (
                      <label key={page.id} className="flex items-center gap-2.5 rounded-md border border-slate-200 px-3 py-2 cursor-pointer hover:bg-slate-50">
                        <Checkbox
                          checked={perms.pageIds.includes(page.id)}
                          onCheckedChange={(v) => togglePage(page.id, v === true)}
                        />
                        <span className="text-sm text-slate-700 truncate">{ml(page.nameJson) || page.path}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-2">{t("roles.recordRights", "Права на записи по сущностям")}</h4>
                {entities.length === 0 ? (
                  <p className="text-xs text-slate-400">{t("roles.noEntities", "Нет сущностей.")}</p>
                ) : (
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="text-left px-3 py-2 font-medium text-slate-600">{t("roles.entity", "Сущность")}</th>
                          {RECORD_ACTIONS.map((a) => (
                            <th key={a.key} className="px-3 py-2 font-medium text-slate-600 text-center whitespace-nowrap">
                              {t(`roles.action.${a.key}`, a.label)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {entities.map((entity: Entity) => {
                          const rp = getRecordPerm(entity.id);
                          return (
                            <tr key={entity.id} className="border-b border-slate-100 last:border-0">
                              <td className="px-3 py-2 text-slate-700">{ml(entity.nameJson) || entity.entityKey}</td>
                              {RECORD_ACTIONS.map((a) => (
                                <td key={a.key} className="px-3 py-2 text-center">
                                  <Checkbox
                                    checked={rp[a.key] === true}
                                    onCheckedChange={(v) => toggleRecord(entity.id, a.key, v === true)}
                                  />
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-1">{t("roles.recordScope", "Область видимости записей")}</h4>
                <p className="text-xs text-slate-400 mb-2">
                  {t("roles.recordScopeDesc", "«Все» — роль видит все записи сущности. «Только свои» — видны только записи, где выбранное поле типа «Пользователь» равно текущему пользователю.")}
                </p>
                {scopedEntities.length === 0 ? (
                  <p className="text-xs text-slate-400">{t("roles.noViewableEntities", "Нет сущностей с правом просмотра.")}</p>
                ) : (
                  <div className="space-y-3">
                    {scopedEntities.map((entity: Entity) => {
                      const rp = getRecordPerm(entity.id);
                      return (
                        <EntityScopeRow
                          key={entity.id}
                          entity={entity}
                          scope={rp.scope ?? "all"}
                          scopeFieldKeys={rp.scopeFieldKeys ?? []}
                          onScopeChange={(s) => setScope(entity.id, s)}
                          onToggleFieldKey={(k, c) => toggleScopeFieldKey(entity.id, k, c)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("roles.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingRole ? t("roles.save", "Сохранить") : t("roles.createShort", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRole} onOpenChange={(o) => !o && setDeleteRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("roles.deleteTitle", "Удалить роль?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("roles.deletePrefix", "Роль")} "{deleteRole?.nameJson?.["ru"] || deleteRole?.nameJson?.["en"]}" {t("roles.deleteSuffix", "будет удалена. Убедитесь, что нет пользователей с этой ролью.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("roles.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteRole && deleteMutation.mutate({ id: deleteRole.id })}
            >
              {t("roles.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EntityScopeRow({
  entity,
  scope,
  scopeFieldKeys,
  onScopeChange,
  onToggleFieldKey,
}: {
  entity: Entity;
  scope: RecordScope;
  scopeFieldKeys: string[];
  onScopeChange: (scope: RecordScope) => void;
  onToggleFieldKey: (key: string, checked: boolean) => void;
}) {
  const ml = useML();
  const t = useT();
  const { data: fields = [] } = useListEntityFields(entity.id);
  const userFields = fields.filter((f: Field) => f.fieldType === "user");

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-slate-700 truncate">{ml(entity.nameJson) || entity.entityKey}</span>
        <Select value={scope} onValueChange={(v) => onScopeChange(v as RecordScope)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("roles.scopeAll", "Все")}</SelectItem>
            <SelectItem value="own">{t("roles.scopeOwn", "Только свои")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {scope === "own" && (
        <div className="pt-1">
          {userFields.length === 0 ? (
            <p className="text-xs text-amber-600">
              {t("roles.noUserFields", "Нет полей типа «Пользователь» — при выборе «Только свои» записи не будут видны. Добавьте такое поле в сущность.")}
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-slate-400">{t("roles.ownerFields", "Поля-владельцы (совпадение по любому):")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {userFields.map((f: Field) => (
                  <label key={f.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <Checkbox
                      checked={scopeFieldKeys.includes(f.fieldKey)}
                      onCheckedChange={(v) => onToggleFieldKey(f.fieldKey, v === true)}
                    />
                    <span className="truncate">{ml(f.nameJson) || f.fieldKey}</span>
                  </label>
                ))}
              </div>
              {!userFields.some((f: Field) => scopeFieldKeys.includes(f.fieldKey)) && (
                <p className="text-xs text-amber-600">
                  {t("roles.noOwnerSelected", "Не выбрано ни одного поля-владельца — при «Только свои» записи не будут видны. Отметьте хотя бы одно поле.")}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
