import { useState } from "react";
import {
  useListPages,
  useCreatePage,
  useUpdatePage,
  useDeletePage,
  useReorderPages,
  useListEntities,
  useListEntityFields,
  type Page,
  type Entity,
  type Field,
  type MultilingualText,
} from "@workspace/api-client-react";
import { PivotPageConfig, type PivotPageConfigValue } from "@/components/PivotPageConfig";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { MultilingualInput } from "@/components/MultilingualInput";
import { IconPicker } from "@/components/IconPicker";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Layout, Loader2, ChevronRight, ChevronUp, ChevronDown, Link2, Unlink } from "lucide-react";
import { useLocation } from "wouter";
import { useML, useT } from "@/lib/i18n";

type MLValue = { ru?: string; en?: string; he?: string };

/** Ensure a non-empty path starts with a single leading slash. Empty stays empty. */
function withSlash(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return `/${trimmed.replace(/^\/+/, "")}`;
}

export default function PagesPage() {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<Page | null>(null);
  const [deletePage, setDeletePage] = useState<Page | null>(null);

  const [nameJson, setNameJson] = useState<MLValue>({});
  const [descJson, setDescJson] = useState<MLValue>({});
  const [icon, setIcon] = useState("");
  const [path, setPath] = useState("");
  const [parentPageId, setParentPageId] = useState<string>("none");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [mirrorEntityId, setMirrorEntityId] = useState<string>("none");
  const [mirrorFieldKeys, setMirrorFieldKeys] = useState<string[]>([]);
  const [groupByFieldKey, setGroupByFieldKey] = useState<string>("none");
  const [pageType, setPageType] = useState<"normal" | "mirror" | "dashboard" | "pivot">("normal");
  const [pivotEntityId, setPivotEntityId] = useState<string>("none");
  const [pivotConfig, setPivotConfig] = useState<PivotPageConfigValue | null>(null);

  const { data: pages = [], isLoading } = useListPages();
  const { data: entities = [] } = useListEntities();
  const [, navigate] = useLocation();

  const entityForPage = (pageId: number): Entity | undefined =>
    entities.find((e: Entity) => e.pageId === pageId);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/pages"] });

  const createMutation = useCreatePage({
    mutation: {
      onSuccess: () => { toast({ title: t("pages.created", "Страница создана") }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: t("pages.createError", "Ошибка создания страницы"), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdatePage({
    mutation: {
      onSuccess: () => { toast({ title: t("pages.updated", "Страница обновлена") }); setDialogOpen(false); invalidate(); },
    },
  });

  const deleteMutation = useDeletePage({
    mutation: {
      onSuccess: () => { toast({ title: t("pages.deleted", "Страница удалена") }); setDeletePage(null); invalidate(); },
      onError: () => toast({ title: t("pages.deleteChildrenError", "Нельзя удалить страницу с дочерними"), variant: "destructive" }),
    },
  });

  const reorderMutation = useReorderPages({
    mutation: {
      onSuccess: () => invalidate(),
      onError: () => toast({ title: t("pages.reorderError", "Ошибка изменения порядка"), variant: "destructive" }),
    },
  });

  const move = (siblings: Page[], index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= siblings.length) return;
    const a = siblings[index];
    const b = siblings[target];
    reorderMutation.mutate({
      data: {
        items: [
          { id: a.id, sortOrder: b.sortOrder },
          { id: b.id, sortOrder: a.sortOrder },
        ],
      },
    });
  };

  const openCreate = () => {
    setEditingPage(null);
    setNameJson({});
    setDescJson({});
    setIcon("");
    setPath("");
    setParentPageId("none");
    setSortOrder(pages.length + 1);
    setIsActive(true);
    setMirrorEntityId("none");
    setMirrorFieldKeys([]);
    setGroupByFieldKey("none");
    setPageType("normal");
    setPivotEntityId("none");
    setPivotConfig(null);
    setDialogOpen(true);
  };

  const openEdit = (page: Page) => {
    setEditingPage(page);
    const n = page.nameJson;
    const d = page.descriptionJson;
    setNameJson(typeof n === "object" && n ? { ru: n.ru, en: n.en, he: n.he } : {});
    setDescJson(typeof d === "object" && d ? { ru: d.ru, en: d.en, he: d.he } : {});
    setIcon(page.icon || "");
    setPath(page.path || "");
    setParentPageId(page.parentPageId ? String(page.parentPageId) : "none");
    setSortOrder(page.sortOrder);
    setIsActive(page.isActive);
    setMirrorEntityId(page.mirrorEntityId ? String(page.mirrorEntityId) : "none");
    setMirrorFieldKeys(page.mirrorFieldKeysJson ?? []);
    setGroupByFieldKey(page.groupByFieldKey || "none");
    setPageType(
      page.isPivot ? "pivot" : page.isDashboard ? "dashboard" : page.mirrorEntityId ? "mirror" : "normal",
    );
    setPivotEntityId(page.pivotEntityId ? String(page.pivotEntityId) : "none");
    setPivotConfig((page.pivotConfigJson as PivotPageConfigValue | null) ?? null);
    setDialogOpen(true);
  };

  // A page that has a bound entity (entities.page_id === page.id) must not also
  // mirror another entity, and vice versa — the two bindings are mutually
  // exclusive (issue: a page showing both is illogical). Disable the mirror
  // selector when the page being edited already has a bound entity.
  const boundEntity = editingPage ? entityForPage(editingPage.id) : undefined;
  const mirrorLockedByBinding = !!boundEntity;
  const normalizedPath = withSlash(path);
  // Path is required whenever the page renders data (a mirror entity or a
  // dashboard), otherwise navigating to it falls through to the home dashboard.
  const pathRequired = pageType === "mirror" || pageType === "dashboard" || pageType === "pivot";
  const pathMissing = pathRequired && normalizedPath === "";

  const handlePageTypeChange = (v: "normal" | "mirror" | "dashboard" | "pivot") => {
    setPageType(v);
    if (v !== "mirror") {
      setMirrorEntityId("none");
      setMirrorFieldKeys([]);
      setGroupByFieldKey("none");
    }
    if (v !== "pivot") {
      setPivotEntityId("none");
      setPivotConfig(null);
    }
  };

  const pivotEntityMissing = pageType === "pivot" && pivotEntityId === "none";

  const handleSubmit = () => {
    if (pathMissing) {
      toast({ title: t("pages.pathRequiredError", "Укажите путь для страницы со связанной сущностью"), variant: "destructive" });
      return;
    }
    if (pivotEntityMissing) {
      toast({ title: t("pages.pivotEntityRequired", "Выберите сущность для сводной таблицы"), variant: "destructive" });
      return;
    }
    const isPivot = pageType === "pivot";
    const payload = {
      nameJson: nameJson as MultilingualText,
      descriptionJson: descJson as MultilingualText,
      icon: icon || "",
      path: normalizedPath || null,
      parentPageId: parentPageId !== "none" ? Number(parentPageId) : null,
      mirrorEntityId: pageType === "mirror" && mirrorEntityId !== "none" ? Number(mirrorEntityId) : null,
      mirrorFieldKeysJson:
        pageType === "mirror" && mirrorEntityId !== "none" && mirrorFieldKeys.length > 0 ? mirrorFieldKeys : null,
      groupByFieldKey:
        pageType === "mirror" && mirrorEntityId !== "none" && groupByFieldKey !== "none" ? groupByFieldKey : null,
      isDashboard: pageType === "dashboard",
      isPivot,
      pivotEntityId: isPivot && pivotEntityId !== "none" ? Number(pivotEntityId) : null,
      pivotConfigJson: isPivot ? (pivotConfig ?? { source: "entity" }) : null,
      sortOrder,
      isActive,
    };
    if (editingPage) {
      updateMutation.mutate({ id: editingPage.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const topPages = pages.filter((p: Page) => !p.parentPageId);
  const sortedTop = [...topPages].sort((a: Page, b: Page) => a.sortOrder - b.sortOrder);
  const subPages = (parentId: number) => pages.filter((p: Page) => p.parentPageId === parentId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("pages.title", "Страницы")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t("pages.subtitle", "Управление навигацией и пунктами меню")}</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          {t("pages.create", "Создать страницу")}
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : pages.length === 0 ? (
            <div className="text-center py-16 text-slate-400">{t("pages.empty", "Страницы не найдены")}</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("pages.colName", "Название")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("pages.colIcon", "Иконка")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("pages.colOrder", "Порядок")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("pages.colStatus", "Статус")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">{t("pages.colActions", "Действия")}</th>
                </tr>
              </thead>
              <tbody>
                {sortedTop.map((page: Page, pi: number) => {
                  const children = subPages(page.id).sort((a: Page, b: Page) => a.sortOrder - b.sortOrder);
                  return [
                    <tr key={page.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Layout className="w-4 h-4 text-slate-400" />
                          <span className="font-medium text-slate-700">{ml(page.nameJson)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{page.icon || "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{page.sortOrder}</td>
                      <td className="px-4 py-3">
                        {page.isActive ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">{t("pages.statusActive", "Активна")}</Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">{t("pages.statusHidden", "Скрыта")}</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={pi === 0 || reorderMutation.isPending} onClick={() => move(sortedTop, pi, -1)}>
                            <ChevronUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={pi === sortedTop.length - 1 || reorderMutation.isPending} onClick={() => move(sortedTop, pi, 1)}>
                            <ChevronDown className="w-3.5 h-3.5" />
                          </Button>
                          {entityForPage(page.id) ? (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" title={t("pages.editEntity", "Редактировать сущность")} onClick={() => navigate(`/admin/entities?edit=${entityForPage(page.id)!.id}`)}>
                              <Link2 className="w-3.5 h-3.5" />
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" title={t("pages.bindEntity", "Привязать сущность")} onClick={() => navigate(`/admin/entities?createForPage=${page.id}`)}>
                              <Unlink className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(page)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeletePage(page)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>,
                    ...children.map((child: Page, ci: number) => (
                      <tr key={child.id} className="border-b border-slate-100 hover:bg-slate-50 bg-slate-50/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 pl-6">
                            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                            <span className="text-slate-600">{ml(child.nameJson)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{child.icon || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{child.sortOrder}</td>
                        <td className="px-4 py-3">
                          {child.isActive ? (
                            <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">{t("pages.statusActive", "Активна")}</Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">{t("pages.statusHidden", "Скрыта")}</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={ci === 0 || reorderMutation.isPending} onClick={() => move(children, ci, -1)}>
                              <ChevronUp className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" disabled={ci === children.length - 1 || reorderMutation.isPending} onClick={() => move(children, ci, 1)}>
                              <ChevronDown className="w-3.5 h-3.5" />
                            </Button>
                            {entityForPage(child.id) ? (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" title={t("pages.editEntity", "Редактировать сущность")} onClick={() => navigate(`/admin/entities?edit=${entityForPage(child.id)!.id}`)}>
                                <Link2 className="w-3.5 h-3.5" />
                              </Button>
                            ) : (
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" title={t("pages.bindEntity", "Привязать сущность")} onClick={() => navigate(`/admin/entities?createForPage=${child.id}`)}>
                                <Unlink className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(child)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeletePage(child)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ];
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPage ? t("pages.editTitle", "Редактировать страницу") : t("pages.newTitle", "Новая страница")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label={t("pages.colName", "Название")} value={nameJson} onChange={setNameJson} required />
            <MultilingualInput label={t("pages.description", "Описание")} value={descJson} onChange={setDescJson} multiline />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("pages.colIcon", "Иконка")}</Label>
                <IconPicker value={icon} onChange={setIcon} />
              </div>
              <div className="space-y-1.5">
                <Label>{t("pages.colOrder", "Порядок")}</Label>
                <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>
                {t("pages.path", "Путь (маршрут)")}
                {pathRequired && <span className="text-red-500"> *</span>}
              </Label>
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                onBlur={() => setPath((p) => withSlash(p))}
                placeholder="/example"
              />
              {pathMissing ? (
                <p className="text-xs text-red-500">
                  {t("pages.pathRequiredHint", "Для страницы со связанной сущностью путь обязателен.")}
                </p>
              ) : (
                <p className="text-xs text-slate-400">{t("pages.pathHint", "Адрес страницы в меню. Слеш в начале добавится автоматически. Оставьте пустым для группы-раздела.")}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t("pages.parent", "Родительская страница")}</Label>
              <Select value={parentPageId} onValueChange={setParentPageId}>
                <SelectTrigger><SelectValue placeholder={t("pages.rootPlaceholder", "Корневая страница")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t("pages.rootOption", "— Корневая —")}</SelectItem>
                  {topPages.filter((p: Page) => !editingPage || p.id !== editingPage.id).map((p: Page) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {ml(p.nameJson)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 rounded-md border border-slate-200 p-3">
              <Label>{t("pages.pageType", "Тип страницы")}</Label>
              {mirrorLockedByBinding && (
                <p className="text-xs text-amber-600">
                  {t("pages.typeLocked", "К этой странице уже привязана сущность. Доступен только обычный тип — страница не может быть зеркалом или дашбордом.")}
                </p>
              )}
              <Select
                value={pageType}
                disabled={mirrorLockedByBinding}
                onValueChange={(v) => handlePageTypeChange(v as "normal" | "mirror" | "dashboard" | "pivot")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">{t("pages.typeNormal", "Обычная")}</SelectItem>
                  <SelectItem value="mirror">{t("pages.typeMirror", "Зеркальная (живые данные сущности)")}</SelectItem>
                  <SelectItem value="dashboard">{t("pages.typeDashboard", "Дашборд (виджеты)")}</SelectItem>
                  <SelectItem value="pivot">{t("pages.typePivot", "Сводная таблица")}</SelectItem>
                </SelectContent>
              </Select>

              {pageType === "mirror" && (
                <>
                  <Label>{t("pages.mirrorEntity", "Связанная сущность (живые данные)")}</Label>
                  <Select
                    value={mirrorEntityId}
                    onValueChange={(v) => {
                      setMirrorEntityId(v);
                      setMirrorFieldKeys([]);
                      setGroupByFieldKey("none");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t("pages.mirrorSelect", "— Выберите сущность —")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("pages.mirrorSelect", "— Выберите сущность —")}</SelectItem>
                      {entities
                        .filter((e: Entity) => e.isActive)
                        .map((e: Entity) => (
                          <SelectItem key={e.id} value={String(e.id)}>
                            {ml(e.nameJson)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-400">
                    {t(
                      "pages.mirrorHint",
                      "Страница покажет живые записи выбранной сущности. Изменения двусторонние; видимость строк и полей определяется правами роли.",
                    )}
                  </p>
                  {mirrorEntityId !== "none" && (
                    <>
                      <GroupByFieldSelect
                        entityId={Number(mirrorEntityId)}
                        value={groupByFieldKey}
                        onChange={setGroupByFieldKey}
                        ml={ml}
                        t={t}
                      />
                      <MirrorFieldPicker
                        entityId={Number(mirrorEntityId)}
                        selected={mirrorFieldKeys}
                        onChange={setMirrorFieldKeys}
                        ml={ml}
                        t={t}
                      />
                    </>
                  )}
                </>
              )}

              {pageType === "dashboard" && (
                <p className="text-xs text-slate-400">
                  {t("pages.dashboardHint", "Страница покажет панель виджетов. Виджеты настраиваются на самой странице кнопкой «Настроить».")}
                </p>
              )}

              {pageType === "pivot" && (
                <>
                  <Label>{t("pages.pivotEntity", "Сущность для сводной таблицы")}</Label>
                  <Select value={pivotEntityId} onValueChange={setPivotEntityId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("pages.pivotEntitySelect", "— Выберите сущность —")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("pages.pivotEntitySelect", "— Выберите сущность —")}</SelectItem>
                      {entities
                        .filter((e: Entity) => e.isActive)
                        .map((e: Entity) => (
                          <SelectItem key={e.id} value={String(e.id)}>
                            {ml(e.nameJson)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {pivotEntityId !== "none" && (
                    <PivotPageConfig
                      key={pivotEntityId}
                      entityId={Number(pivotEntityId)}
                      initial={pivotConfig}
                      onChange={setPivotConfig}
                      ml={ml}
                      t={t}
                    />
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} id="page-active" />
              <Label htmlFor="page-active">{t("pages.activeInMenu", "Активна (видна в меню)")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("pages.cancel", "Отмена")}</Button>
            <Button onClick={handleSubmit} disabled={isPending || pathMissing} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingPage ? t("pages.save", "Сохранить") : t("pages.createShort", "Создать")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePage} onOpenChange={(o) => !o && setDeletePage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("pages.deleteTitle", "Удалить страницу?")}</AlertDialogTitle>
            <AlertDialogDescription>
              "{ml(deletePage?.nameJson)}" {t("pages.deleteConfirm", "будет удалена безвозвратно.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("pages.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deletePage && deleteMutation.mutate({ id: deletePage.id })}
            >
              {t("pages.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * "Group by" selector for a mirror page: any active stored field of the
 * mirrored entity except function/file (not groupable — server enforces the
 * same rule, plus single-link for relation/lookup).
 */
function GroupByFieldSelect({
  entityId,
  value,
  onChange,
  ml,
  t,
}: {
  entityId: number;
  value: string;
  onChange: (v: string) => void;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
}) {
  const { data: fields = [] } = useListEntityFields(entityId);
  const groupable = fields.filter(
    (f: Field) => f.isActive && f.fieldType !== "function" && f.fieldType !== "file",
  );

  return (
    <div className="space-y-1.5 pt-1">
      <Label>{t("pages.groupBy", "Группировать по")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={t("pages.groupByNone", "— Без группировки —")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{t("pages.groupByNone", "— Без группировки —")}</SelectItem>
          {groupable.map((f: Field) => (
            <SelectItem key={f.id} value={f.fieldKey}>
              {ml(f.nameJson) || f.fieldKey}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-slate-400">
        {t(
          "pages.groupByHint",
          "Записи будут сгруппированы по значению этого поля: свёрнутые группы с количеством и суммами (для полей с включённым «Итог по колонке»).",
        )}
      </p>
    </div>
  );
}

function MirrorFieldPicker({
  entityId,
  selected,
  onChange,
  ml,
  t,
}: {
  entityId: number;
  selected: string[];
  onChange: (keys: string[]) => void;
  ml: (v: unknown) => string;
  t: (key: string, fallback: string) => string;
}) {
  const { data: fields = [], isLoading } = useListEntityFields(entityId);
  const active = fields.filter((f: Field) => f.isActive);

  const toggle = (key: string, checked: boolean) => {
    if (checked) onChange([...selected, key]);
    else onChange(selected.filter((k) => k !== key));
  };

  if (isLoading) {
    return <Skeleton className="h-20 w-full" />;
  }
  if (active.length === 0) {
    return <p className="text-xs text-slate-400">{t("pages.mirrorNoFields", "У сущности нет полей.")}</p>;
  }

  return (
    <div className="space-y-2 pt-1">
      <p className="text-xs font-medium text-slate-600">
        {t("pages.mirrorFields", "Какие поля показать (пусто = все)")}
      </p>
      <p className="text-xs text-slate-400">
        {t("pages.mirrorLabelInlineHint", "Переименовать заголовки полей можно прямо на странице: «Режим настройки» → клик по заголовку.")}
      </p>
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {active.map((f: Field) => {
          const isSelected = selected.includes(f.fieldKey);
          return (
            <label key={f.id} className="flex items-center gap-2 rounded-md border border-slate-100 p-2 text-sm text-slate-700 cursor-pointer">
              <Checkbox
                checked={isSelected}
                onCheckedChange={(c) => toggle(f.fieldKey, c === true)}
              />
              <span className="truncate">{ml(f.nameJson)}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
