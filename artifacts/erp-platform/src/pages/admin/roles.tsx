import { useState, Fragment } from "react";
import {
  useListRoles,
  useCreateRole,
  useUpdateRole,
  useDeleteRole,
  useListPages,
  useListEntities,
  useListEntityFields,
  useListEntityStatuses,
  getListEntityStatusesQueryKey,
  type Role,
  type RolePermissions,
  type RoleAdminCaps,
  type RecordPermission,
  type RecordScope,
  type Page,
  type Entity,
  type Field,
  type Status,
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
import { Plus, Pencil, Trash2, Shield, Loader2, Users, Crown, CornerDownRight } from "lucide-react";
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

// Compact labels for the role-card permission summary (the dialog uses the
// longer ADMIN_CAP_LABELS; chips on the card need short names).
const CAP_SHORT: { key: keyof RoleAdminCaps; label: string }[] = [
  { key: "pages", label: "Страницы" },
  { key: "entities", label: "Сущности" },
  { key: "roles", label: "Роли" },
  { key: "users", label: "Пользователи" },
  { key: "translations", label: "Переводы" },
  { key: "events", label: "События" },
  { key: "modules", label: "Модули" },
  { key: "googleDrive", label: "Google Drive" },
  { key: "settings", label: "Настройки" },
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
  // Entity ids whose "status rights" block is open in the editor. Stored
  // separately from perms because an entity can be configured with everything
  // still checked (empty hidden arrays) — presence here = the block is shown.
  const [statusEntityIds, setStatusEntityIds] = useState<number[]>([]);
  const [addStatusEntityId, setAddStatusEntityId] = useState<string>("");

  // Permission filter (top of page): "all" = no filter. Status depends on entity.
  const [filterPageId, setFilterPageId] = useState<string>("all");
  const [filterEntityId, setFilterEntityId] = useState<string>("all");
  const [filterStatusId, setFilterStatusId] = useState<string>("all");

  const { data: roles = [], isLoading } = useListRoles();
  const { data: pages = [] } = useListPages();
  const { data: entities = [] } = useListEntities();

  // Dependent status options for the filter — only fetched once an entity is chosen.
  const filterEntityNum = filterEntityId === "all" ? 0 : Number(filterEntityId);
  const { data: filterStatuses = [] } = useListEntityStatuses(filterEntityNum, {
    query: {
      enabled: filterEntityNum > 0,
      queryKey: getListEntityStatusesQueryKey(filterEntityNum),
    },
  });

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
    setStatusEntityIds([]);
    setAddStatusEntityId("");
    setDialogOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditingRole(role);
    setNameJson(role.nameJson || {});
    setDescJson(role.descriptionJson || {});
    const base = emptyPerms();
    const p = role.permissionsJson;
    const records = p?.records ?? {};
    setPerms(
      p
        ? {
            superAdmin: p.superAdmin ?? false,
            admin: { ...base.admin, ...(p.admin ?? {}) },
            pageIds: p.pageIds ?? [],
            records,
          }
        : base,
    );
    // Open a status-rights block for every entity that already has a configured
    // exception (keys "<entityId>" only — mirror keys are not entities).
    setStatusEntityIds(
      Object.entries(records)
        .filter(
          ([k, rp]) =>
            /^\d+$/.test(k) &&
            (((rp as RecordPermission).hiddenStatusIds?.length ?? 0) > 0 ||
              ((rp as RecordPermission).hiddenRowStatusIds?.length ?? 0) > 0),
        )
        .map(([k]) => Number(k)),
    );
    setAddStatusEntityId("");
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

  // Mirror-page record-rights override (key `mirror:<pageId>`). Presence of the
  // key = override; absence = inherit the source entity's rights.
  const mirrorKey = (pageId: number) => `mirror:${pageId}`;
  const isMirrorOverridden = (pageId: number) => mirrorKey(pageId) in perms.records;
  const getMirrorPerm = (pageId: number): RecordPermission =>
    perms.records[mirrorKey(pageId)] ?? { view: false, create: false, update: false, delete: false };

  // Toggle a single CRUD bit on an arbitrary record-perm key (entity or mirror),
  // applying the same view-implies-write / clear-on-view-off rules.
  const toggleRecordKey = (key: string, action: keyof RecordPermission, checked: boolean) =>
    setPerms((prev) => {
      const current: RecordPermission =
        prev.records[key] ?? { view: false, create: false, update: false, delete: false };
      const next: RecordPermission = { ...current, [action]: checked };
      if (checked && action !== "view") next.view = true;
      if (action === "view" && !checked) {
        next.create = false;
        next.update = false;
        next.delete = false;
      }
      return { ...prev, records: { ...prev.records, [key]: next } };
    });

  // Turn a mirror override on (seeding from the entity's current rights as a
  // starting point) or off (removing the key so the page inherits the entity).
  const toggleMirrorOverride = (entityId: number, pageId: number, on: boolean) =>
    setPerms((prev) => {
      const records = { ...prev.records };
      const key = mirrorKey(pageId);
      if (on) {
        const ent = prev.records[String(entityId)] ?? { view: false, create: false, update: false, delete: false };
        records[key] = { view: ent.view, create: ent.create, update: ent.update, delete: ent.delete };
      } else {
        delete records[key];
      }
      return { ...prev, records };
    });

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

  // ----- Status visibility per entity (sparse: only the OFF exceptions stored) -----

  // Toggle one hidden-status array (hiddenStatusIds | hiddenRowStatusIds) for an
  // entity. `shown === false` adds the id (a stored exception); `true` removes it.
  const setStatusFlag = (
    entityId: number,
    field: "hiddenStatusIds" | "hiddenRowStatusIds",
    statusId: number,
    shown: boolean,
  ) =>
    setPerms((prev) => {
      const key = String(entityId);
      const current: RecordPermission =
        prev.records[key] ?? { view: false, create: false, update: false, delete: false };
      const list = current[field] ?? [];
      const next = shown ? list.filter((id) => id !== statusId) : [...new Set([...list, statusId])];
      return { ...prev, records: { ...prev.records, [key]: { ...current, [field]: next } } };
    });

  const addStatusEntity = () => {
    const id = Number(addStatusEntityId);
    if (!Number.isInteger(id)) return;
    setStatusEntityIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setAddStatusEntityId("");
  };

  // Remove an entity's status-rights block and clear its stored exceptions so the
  // role reverts to "all statuses visible" for that entity.
  const removeStatusEntity = (entityId: number) => {
    setStatusEntityIds((prev) => prev.filter((id) => id !== entityId));
    setPerms((prev) => {
      const key = String(entityId);
      const current = prev.records[key];
      if (!current) return prev;
      const { hiddenStatusIds: _h, hiddenRowStatusIds: _r, ...rest } = current;
      return { ...prev, records: { ...prev.records, [key]: rest } };
    });
  };

  const statusConfigurableEntities = entities.filter((e: Entity) => !statusEntityIds.includes(e.id));

  const scopedEntities = entities.filter((e: Entity) => getRecordPerm(e.id).view);

  // ----- Permission filter helpers (superAdmin implicitly has full access) -----
  const roleHasPageAccess = (role: Role, pageId: number) =>
    role.permissionsJson?.superAdmin === true ||
    (role.permissionsJson?.pageIds ?? []).includes(pageId);
  const roleEntityPerm = (role: Role, entityId: number): RecordPermission | undefined =>
    role.permissionsJson?.records?.[String(entityId)];
  const roleHasEntityAccess = (role: Role, entityId: number) =>
    role.permissionsJson?.superAdmin === true || roleEntityPerm(role, entityId)?.view === true;
  const roleHasStatusAccess = (role: Role, entityId: number, statusId: number) => {
    if (role.permissionsJson?.superAdmin === true) return true;
    const rp = roleEntityPerm(role, entityId);
    if (rp?.view !== true) return false;
    return (
      !(rp.hiddenStatusIds ?? []).includes(statusId) &&
      !(rp.hiddenRowStatusIds ?? []).includes(statusId)
    );
  };

  const filterActive = filterPageId !== "all" || filterEntityId !== "all";
  const filteredRoles = roles.filter((role: Role) => {
    if (filterPageId !== "all" && !roleHasPageAccess(role, Number(filterPageId))) return false;
    if (filterEntityNum > 0) {
      if (filterStatusId !== "all") {
        if (!roleHasStatusAccess(role, filterEntityNum, Number(filterStatusId))) return false;
      } else if (!roleHasEntityAccess(role, filterEntityNum)) {
        return false;
      }
    }
    return true;
  });

  const resetFilters = () => {
    setFilterPageId("all");
    setFilterEntityId("all");
    setFilterStatusId("all");
  };

  // Compact, read-only permission summary shown on each role card so admins can
  // see what a role grants without opening the editor. superAdmin cards already
  // show the "Полный доступ" badge, so we skip the detailed list for them.
  const renderPermsSummary = (role: Role) => {
    const p = role.permissionsJson;
    if (!p || p.superAdmin) return null;
    const caps = CAP_SHORT.filter(({ key }) => p.admin?.[key]);
    // Only content pages are page-gated (mirrors the editor's contentPages
    // boundary); skip any admin/root ids that may linger in pageIds.
    const pageNames = (p.pageIds ?? [])
      .map((id) => contentPages.find((pg: Page) => pg.id === id))
      .filter((pg): pg is Page => Boolean(pg))
      .map((pg) => ml(pg.nameJson) || pg.path || "—");
    const records = p.records ?? {};
    const entityPerms = Object.entries(records)
      .filter(
        ([k, rp]) =>
          /^\d+$/.test(k) &&
          (rp.view === true || rp.create === true || rp.update === true || rp.delete === true),
      )
      .map(([k, rp]) => {
        const ent = entities.find((e: Entity) => e.id === Number(k));
        return { id: k, name: ent ? ml(ent.nameJson) || ent.entityKey : `#${k}`, rp };
      });
    // Mirror-page record overrides (key `mirror:<pageId>`): rights granted only
    // through a mirror page, not via the source entity directly.
    const mirrorPerms = Object.entries(records)
      .filter(
        ([k, rp]) =>
          k.startsWith("mirror:") &&
          (rp.view === true || rp.create === true || rp.update === true || rp.delete === true),
      )
      .map(([k, rp]) => {
        const pageId = Number(k.slice("mirror:".length));
        const page = pages.find((pg: Page) => pg.id === pageId);
        const ent = page ? entities.find((e: Entity) => e.id === page.mirrorEntityId) : undefined;
        return {
          id: k,
          label: page ? ml(page.nameJson) || page.path || `#${pageId}` : `#${pageId}`,
          entName: ent ? ml(ent.nameJson) || ent.entityKey : null,
          rp,
        };
      });

    if (
      caps.length === 0 &&
      pageNames.length === 0 &&
      entityPerms.length === 0 &&
      mirrorPerms.length === 0
    ) {
      return (
        <p className="text-xs text-slate-400 mt-3 pt-3 border-t border-slate-100">
          {t("roles.cardNoPerms", "Права не назначены")}
        </p>
      );
    }

    const sectionTitle = "text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1";
    return (
      <div className="mt-3 pt-3 border-t border-slate-100 space-y-2.5">
        {entityPerms.length > 0 && (
          <div>
            <p className={sectionTitle}>{t("roles.cardData", "Данные")}</p>
            <div className="space-y-1.5">
              {entityPerms.map(({ id, name, rp }) => (
                <div key={id} className="space-y-0.5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs text-slate-600 min-w-0 truncate">
                      {name}
                      {rp.scope === "own" && (
                        <span className="text-slate-400"> · {t("roles.scopeOwnShort", "свои")}</span>
                      )}
                    </span>
                    <div className="flex flex-wrap gap-1 justify-end shrink-0">
                      {RECORD_ACTIONS.filter((a) => rp[a.key] === true).map((a) => (
                        <span
                          key={a.key}
                          className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] leading-none"
                        >
                          {t(`roles.action.${a.key}`, a.label)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <EntityStatusChips
                    entityId={Number(id)}
                    hiddenStatusIds={rp.hiddenStatusIds ?? []}
                    hiddenRowStatusIds={rp.hiddenRowStatusIds ?? []}
                  />
                </div>
              ))}
            </div>
          </div>
        )}
        {mirrorPerms.length > 0 && (
          <div>
            <p className={sectionTitle}>{t("roles.cardMirror", "Зеркальные страницы")}</p>
            <div className="space-y-1">
              {mirrorPerms.map(({ id, label, entName, rp }) => (
                <div key={id} className="flex items-start justify-between gap-2">
                  <span className="text-xs text-slate-600 min-w-0 truncate">
                    {label}
                    {entName && <span className="text-slate-400"> · {entName}</span>}
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end shrink-0">
                    {RECORD_ACTIONS.filter((a) => rp[a.key] === true).map((a) => (
                      <span
                        key={a.key}
                        className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] leading-none"
                      >
                        {t(`roles.action.${a.key}`, a.label)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {pageNames.length > 0 && (
          <div>
            <p className={sectionTitle}>{t("roles.cardPages", "Страницы")}</p>
            <div className="flex flex-wrap gap-1">
              {pageNames.map((n, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[10px] leading-none"
                >
                  {n}
                </span>
              ))}
            </div>
          </div>
        )}
        {caps.length > 0 && (
          <div>
            <p className={sectionTitle}>{t("roles.cardAdmin", "Администрирование")}</p>
            <div className="flex flex-wrap gap-1">
              {caps.map(({ key, label }) => (
                <span
                  key={key}
                  className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 text-[10px] leading-none"
                >
                  {t(`roles.capShort.${key}`, label)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

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

      {!isLoading && roles.length > 0 && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
          <div className="space-y-1">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {t("roles.filterByPage", "Страница")}
            </label>
            <Select value={filterPageId} onValueChange={setFilterPageId}>
              <SelectTrigger className="w-52 h-9 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("roles.filterAllPages", "Все страницы")}</SelectItem>
                {contentPages.map((page: Page) => (
                  <SelectItem key={page.id} value={String(page.id)}>
                    {ml(page.nameJson) || page.path}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {t("roles.filterByEntity", "Сущность")}
            </label>
            <Select
              value={filterEntityId}
              onValueChange={(v) => {
                setFilterEntityId(v);
                setFilterStatusId("all");
              }}
            >
              <SelectTrigger className="w-52 h-9 bg-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("roles.filterAllEntities", "Все сущности")}</SelectItem>
                {entities.map((entity: Entity) => (
                  <SelectItem key={entity.id} value={String(entity.id)}>
                    {ml(entity.nameJson) || entity.entityKey}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {t("roles.filterByStatus", "Статус")}
            </label>
            <Select value={filterStatusId} onValueChange={setFilterStatusId} disabled={filterEntityNum === 0}>
              <SelectTrigger className="w-52 h-9 bg-white">
                <SelectValue placeholder={t("roles.filterStatusPlaceholder", "Сначала выберите сущность")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("roles.filterAllStatuses", "Все статусы")}</SelectItem>
                {filterStatuses.map((s: Status) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {ml(s.nameJson)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {filterActive && (
            <Button variant="ghost" size="sm" className="h-9 text-slate-500" onClick={resetFilters}>
              {t("roles.filterReset", "Сбросить")}
            </Button>
          )}
        </div>
      )}

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
      ) : filteredRoles.length === 0 ? (
        <div className="text-center py-16 text-slate-400">{t("roles.filterEmpty", "Нет ролей по выбранному фильтру")}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRoles.map((role) => (
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

                {renderPermsSummary(role)}

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
                          // Mirror pages of this entity become first-class permission
                          // targets that override the entity rights only for actions
                          // taken through that page.
                          const mirrorPages = pages.filter(
                            (p: Page) => p.mirrorEntityId === entity.id,
                          );
                          return (
                            <Fragment key={entity.id}>
                              <tr className="border-b border-slate-100">
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
                              {mirrorPages.map((page: Page) => {
                                const overridden = isMirrorOverridden(page.id);
                                const mp = getMirrorPerm(page.id);
                                const key = mirrorKey(page.id);
                                return (
                                  <tr key={`m-${page.id}`} className="border-b border-slate-100 bg-slate-50/40">
                                    <td className="px-3 py-2">
                                      <div className="pl-4 text-slate-600 min-w-0">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <CornerDownRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                          <span className="truncate">
                                            {ml(entity.nameJson) || entity.entityKey}{" "}
                                            <span className="text-slate-400">({ml(page.nameJson) || page.path})</span>
                                          </span>
                                        </div>
                                        <label className="flex items-center gap-1.5 mt-1 pl-5 cursor-pointer">
                                          <Switch
                                            checked={overridden}
                                            onCheckedChange={(v) => toggleMirrorOverride(entity.id, page.id, v === true)}
                                          />
                                          <span className="text-xs text-slate-400">
                                            {t("roles.overrideRights", "Переопределить права")}
                                          </span>
                                        </label>
                                      </div>
                                    </td>
                                    {RECORD_ACTIONS.map((a) => (
                                      <td key={a.key} className="px-3 py-2 text-center">
                                        <Checkbox
                                          checked={overridden && mp[a.key] === true}
                                          disabled={!overridden}
                                          onCheckedChange={(v) => toggleRecordKey(key, a.key, v === true)}
                                        />
                                      </td>
                                    ))}
                                  </tr>
                                );
                              })}
                            </Fragment>
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

              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-1">{t("roles.statusRights", "Права на статусы")}</h4>
                <p className="text-xs text-slate-400 mb-2">
                  {t(
                    "roles.statusRightsDesc",
                    "Для выбранной сущности можно скрыть отдельные статусы у этой роли: «Отображать статус» — статус доступен в выборе и фильтре; «Отображать строки» — записи в этом статусе видны роли. По умолчанию включено всё.",
                  )}
                </p>
                {statusEntityIds.length > 0 && (
                  <div className="space-y-3 mb-2">
                    {statusEntityIds.map((entityId) => {
                      const entity = entities.find((e: Entity) => e.id === entityId);
                      if (!entity) return null;
                      const rp = getRecordPerm(entityId);
                      return (
                        <EntityStatusPermsRow
                          key={entityId}
                          entity={entity}
                          hiddenStatusIds={rp.hiddenStatusIds ?? []}
                          hiddenRowStatusIds={rp.hiddenRowStatusIds ?? []}
                          onToggleShown={(sid, shown) => setStatusFlag(entityId, "hiddenStatusIds", sid, shown)}
                          onToggleRowsShown={(sid, shown) => setStatusFlag(entityId, "hiddenRowStatusIds", sid, shown)}
                          onRemove={() => removeStatusEntity(entityId)}
                        />
                      );
                    })}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Select value={addStatusEntityId} onValueChange={setAddStatusEntityId}>
                    <SelectTrigger className="w-56 h-9">
                      <SelectValue placeholder={t("roles.statusSelectEntity", "Выберите сущность")} />
                    </SelectTrigger>
                    <SelectContent>
                      {statusConfigurableEntities.length === 0 ? (
                        <div className="px-2 py-1.5 text-xs text-slate-400">
                          {t("roles.statusAllAdded", "Все сущности добавлены")}
                        </div>
                      ) : (
                        statusConfigurableEntities.map((entity: Entity) => (
                          <SelectItem key={entity.id} value={String(entity.id)}>
                            {ml(entity.nameJson) || entity.entityKey}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" className="h-9 gap-1.5" disabled={!addStatusEntityId} onClick={addStatusEntity}>
                    <Plus className="w-4 h-4" />
                    {t("roles.addStatusRights", "Добавить права на статусы")}
                  </Button>
                </div>
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

// Card-summary helper: shows which statuses are hidden for a role on an entity.
// Loads the entity's statuses lazily (only when there is something to show) so
// the roles list doesn't fire a status query per entity unnecessarily.
function EntityStatusChips({
  entityId,
  hiddenStatusIds,
  hiddenRowStatusIds,
}: {
  entityId: number;
  hiddenStatusIds: number[];
  hiddenRowStatusIds: number[];
}) {
  const ml = useML();
  const t = useT();
  const hasRestrictions = hiddenStatusIds.length > 0 || hiddenRowStatusIds.length > 0;
  const { data: statuses = [] } = useListEntityStatuses(entityId, {
    query: {
      enabled: hasRestrictions,
      queryKey: getListEntityStatusesQueryKey(entityId),
    },
  });
  if (!hasRestrictions) return null;
  const nameOf = (id: number) => {
    const s = statuses.find((st: Status) => st.id === id);
    return s ? ml(s.nameJson) || String(id) : `#${id}`;
  };
  const hiddenNames = hiddenStatusIds.map(nameOf);
  const hiddenRowNames = hiddenRowStatusIds.map(nameOf);
  return (
    <div className="space-y-0.5">
      {hiddenNames.length > 0 && (
        <p className="text-[10px] text-slate-400">
          {t("roles.cardStatusHidden", "Статусы скрыты")}: {hiddenNames.join(", ")}
        </p>
      )}
      {hiddenRowNames.length > 0 && (
        <p className="text-[10px] text-slate-400">
          {t("roles.cardRowsHidden", "Строки скрыты")}: {hiddenRowNames.join(", ")}
        </p>
      )}
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

function EntityStatusPermsRow({
  entity,
  hiddenStatusIds,
  hiddenRowStatusIds,
  onToggleShown,
  onToggleRowsShown,
  onRemove,
}: {
  entity: Entity;
  hiddenStatusIds: number[];
  hiddenRowStatusIds: number[];
  onToggleShown: (statusId: number, shown: boolean) => void;
  onToggleRowsShown: (statusId: number, shown: boolean) => void;
  onRemove: () => void;
}) {
  const ml = useML();
  const t = useT();
  const { data: statuses = [] } = useListEntityStatuses(entity.id);

  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-slate-700 truncate">{ml(entity.nameJson) || entity.entityKey}</span>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-slate-400 hover:text-red-600" onClick={onRemove}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      {statuses.length === 0 ? (
        <p className="text-xs text-slate-400">{t("roles.statusNone", "У сущности нет статусов.")}</p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-4 pl-1 pb-1 text-[11px] uppercase tracking-wide text-slate-400">
            <span className="flex-1">{t("roles.statusName", "Статус")}</span>
            <span className="w-28 text-center">{t("roles.statusShow", "Отображать статус")}</span>
            <span className="w-28 text-center">{t("roles.statusShowRows", "Отображать строки")}</span>
          </div>
          {statuses.map((s: Status) => (
            <div key={s.id} className="flex items-center gap-4 pl-1">
              <span className="flex-1 flex items-center gap-2 text-sm text-slate-700 truncate">
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color || "#cbd5e1" }} />
                {ml(s.nameJson)}
              </span>
              <div className="w-28 flex justify-center">
                <Checkbox
                  checked={!hiddenStatusIds.includes(s.id)}
                  onCheckedChange={(c) => onToggleShown(s.id, c === true)}
                />
              </div>
              <div className="w-28 flex justify-center">
                <Checkbox
                  checked={!hiddenRowStatusIds.includes(s.id)}
                  onCheckedChange={(c) => onToggleRowsShown(s.id, c === true)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
