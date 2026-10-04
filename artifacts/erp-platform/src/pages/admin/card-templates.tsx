import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListCardTemplates,
  getListCardTemplatesQueryKey,
  createCardTemplate,
  updateCardTemplate,
  deleteCardTemplate,
  publishCardTemplate,
  unpublishCardTemplate,
  listEntityFields,
  useListEntities,
  useListPages,
  useListEntityFields,
  useListEntityRelations,
  getListEntityFieldsQueryKey,
  type CardTemplate,
  type CardTemplateInputLayout,
  type Entity,
  type Field,
  type Page,
} from "@workspace/api-client-react";
import {
  ArrowDown, ArrowLeft, ArrowUp, Columns2, Columns3, Copy, GripVertical, LayoutTemplate, Minus, Pencil, Plus,
  Rocket, Save, Square, Table2, Trash2, Type, Undo2, AlertTriangle, Loader2, FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MultilingualInput } from "@/components/MultilingualInput";
import { ColorPickerControl } from "@/components/ColorPickerControl";
import { useToast } from "@/hooks/use-toast";
import { useML, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  CARD_MODES, boundFieldKeys, copyLayout, findBlock, insertBlock, layoutIssues, makeBlock, moveBlock, moveItem,
  newId, parseCardLayout, presetLayout, removeBlock, updateBlock, mlIsEmpty,
  type CardBlock, type CardBlockKind, type CardLayout, type CardMode, type CardSection, type CardStyle, type LayoutPreset,
} from "@/lib/cardLayout";
import { SECTION_GRID, BLOCK_SPAN } from "@/components/CardLayoutView";
import { cardAppearance } from "@/lib/cardAppearance";

const NO_PAGE = "__entity__";
type ApiErr = { status?: number; data?: unknown; message?: string };
const errStatus = (e: unknown) => (e as ApiErr | null)?.status;
function errMessage(e: unknown): string {
  const d = (e as ApiErr | null)?.data;
  if (d && typeof d === "object" && "error" in d && typeof (d as { error: unknown }).error === "string") {
    const details = (d as { details?: unknown }).details;
    return (d as { error: string }).error + (Array.isArray(details) ? `: ${details.map(x => typeof x === "string" ? x : JSON.stringify(x)).join("; ")}` : "");
  }
  return e instanceof Error ? e.message : String(e);
}
function activeConflict(e: unknown): CardTemplate | null {
  if (errStatus(e) !== 409) return null;
  const d = (e as ApiErr).data as { active?: CardTemplate } | null;
  return d?.active && typeof d.active.id === "number" ? d.active : null;
}
const asInput = (l: CardLayout) => l as unknown as CardTemplateInputLayout;

/** Pages that render a given entity: its own page and mirror pages of it. */
function pagesForEntity(pages: Page[], entities: Entity[], entityId: number | null): Page[] {
  if (entityId == null) return [];
  const ent = entities.find(e => e.id === entityId);
  return pages.filter(p => p.id === ent?.pageId || p.mirrorEntityId === entityId);
}

// ---------------------------------------------------------------------------
// Publication flow (shared by list and editor): explicit replacement consent.
function usePublishFlow(onDone: () => void) {
  const { toast } = useToast();
  const t = useT();
  const qc = useQueryClient();
  const [conflict, setConflict] = useState<{ template: CardTemplate; active: CardTemplate } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: getListCardTemplatesQueryKey() });
  const publish = async (template: CardTemplate, replace?: CardTemplate) => {
    setBusy(true);
    try {
      await publishCardTemplate(template.id, {
        expectedRevision: template.revision,
        ...(replace ? { replaceId: replace.id, replaceRevision: replace.revision } : {}),
      });
      setConflict(null);
      toast({ title: t("cards.published", "Карточка опубликована") });
      onDone();
    } catch (e) {
      const active = activeConflict(e);
      if (active && !replace) setConflict({ template, active });
      else {
        setConflict(null);
        toast({ variant: "destructive", title: t("cards.publishFailed", "Не удалось опубликовать"), description: errMessage(e) });
      }
    } finally {
      setBusy(false);
      void refresh();
    }
  };
  const ml = useML();
  const entityLabel = (id: number, entities: Entity[]) => ml(entities.find(e => e.id === id)?.nameJson) || `#${id}`;
  const dialog = (entities: Entity[]) => (
    <AlertDialog open={!!conflict} onOpenChange={o => { if (!o && !busy) setConflict(null); }}>
      <AlertDialogContent data-testid="dialog-publish-conflict">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("cards.replaceTitle", "Заменить активную карточку?")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("cards.replaceDesc", "Для этой области уже опубликована карточка. Она будет переведена в черновики, а новая станет активной. Открытые формы пользователей не сбросятся: новая карточка применится при следующем открытии.")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {conflict && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="text-conflict-active">
            <div className="font-medium text-amber-900">{conflict.active.name}</div>
            <div className="text-xs text-amber-700">
              {entityLabel(conflict.active.entityId, entities)} · {t("cards.revision", "Ревизия")} {conflict.active.revision}
            </div>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} data-testid="button-conflict-cancel">{t("common.cancel", "Отмена")}</AlertDialogCancel>
          <AlertDialogAction data-testid="button-conflict-replace" disabled={busy}
            onClick={e => { e.preventDefault(); if (conflict) void publish(conflict.template, conflict.active); }}>
            {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {t("cards.replaceConfirm", "Заменить и опубликовать")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  return { publish, busy, dialog };
}

// ---------------------------------------------------------------------------
function StateBadge({ state }: { state: CardTemplate["state"] }) {
  const t = useT();
  return state === "published"
    ? <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50" variant="outline" data-testid="badge-published">{t("cards.statePublished", "Опубликована")}</Badge>
    : <Badge className="border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-50" variant="outline" data-testid="badge-draft">{t("cards.stateDraft", "Черновик")}</Badge>;
}

function EntityPageFields({ entityId, pageId, onEntity, onPage, entities, pages, lockEntity }: {
  entityId: number | null; pageId: number | null; onEntity: (id: number) => void; onPage: (id: number | null) => void;
  entities: Entity[]; pages: Page[]; lockEntity?: boolean;
}) {
  const t = useT();
  const ml = useML();
  const scopePages = pagesForEntity(pages, entities, entityId);
  return (
    <>
      <div className="space-y-1.5">
        <Label>{t("cards.entity", "Сущность")}</Label>
        <Select value={entityId != null ? String(entityId) : ""} onValueChange={v => { onEntity(Number(v)); onPage(null); }} disabled={lockEntity}>
          <SelectTrigger data-testid="select-entity"><SelectValue placeholder={t("cards.chooseEntity", "Выберите сущность")} /></SelectTrigger>
          <SelectContent>
            {entities.filter(e => e.isActive).map(e => <SelectItem key={e.id} value={String(e.id)}>{ml(e.nameJson)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>{t("cards.scope", "Область применения")}</Label>
        <Select value={pageId != null ? String(pageId) : NO_PAGE} onValueChange={v => onPage(v === NO_PAGE ? null : Number(v))} disabled={entityId == null}>
          <SelectTrigger data-testid="select-scope"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PAGE}>{t("cards.scopeEntity", "Все страницы сущности (по умолчанию)")}</SelectItem>
            {scopePages.map(p => <SelectItem key={p.id} value={String(p.id)}>{t("cards.scopePage", "Только страница")}: {ml(p.nameJson)}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-slate-500">{t("cards.scopeHint", "Карточка страницы имеет приоритет над карточкой сущности.")}</p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
function CreateDialog({ open, onOpenChange, entities, pages }: { open: boolean; onOpenChange: (o: boolean) => void; entities: Entity[]; pages: Page[] }) {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [entityId, setEntityId] = useState<number | null>(null);
  const [pageId, setPageId] = useState<number | null>(null);
  const [preset, setPreset] = useState<LayoutPreset>("standard");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setName(""); setEntityId(null); setPageId(null); setPreset("standard"); } }, [open]);
  const submit = async () => {
    if (!name.trim() || entityId == null) return;
    setBusy(true);
    try {
      const fields = await listEntityFields(entityId);
      const created = await createCardTemplate({ name: name.trim(), entityId, pageId, layout: asInput(presetLayout(fields, preset)) });
      await qc.invalidateQueries({ queryKey: getListCardTemplatesQueryKey() });
      onOpenChange(false);
      navigate(`/admin/card-templates/${created.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: t("cards.createFailed", "Не удалось создать карточку"), description: errMessage(e) });
    } finally { setBusy(false); }
  };
  const presets: { key: LayoutPreset; title: string; desc: string; icon: ReactNode }[] = [
    { key: "standard", title: t("cards.presetStandard", "Стандартный"), desc: t("cards.presetStandardDesc", "Как текущая форма ERP: одна колонка"), icon: <Square className="h-4 w-4" /> },
    { key: "compact", title: t("cards.presetCompact", "Компактный"), desc: t("cards.presetCompactDesc", "Две колонки, плотные отступы"), icon: <Columns2 className="h-4 w-4" /> },
    { key: "sectioned", title: t("cards.presetSectioned", "Разделы"), desc: t("cards.presetSectionedDesc", "Данные и связи в отдельных блоках"), icon: <Columns3 className="h-4 w-4" /> },
  ];
  return (
    <Dialog open={open} onOpenChange={o => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("cards.newTitle", "Новая карточка")}</DialogTitle>
          <DialogDescription>{t("cards.newDesc", "Карточка создаётся как черновик и не влияет на формы до публикации.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("cards.name", "Название")}</Label>
            <Input data-testid="input-template-name" value={name} onChange={e => setName(e.target.value)} maxLength={200} />
          </div>
          <EntityPageFields entityId={entityId} pageId={pageId} onEntity={setEntityId} onPage={setPageId} entities={entities} pages={pages} />
          <div className="space-y-1.5">
            <Label>{t("cards.startFrom", "Начальный вариант")}</Label>
            <div className="grid gap-2 sm:grid-cols-3">
              {presets.map(p => (
                <button key={p.key} type="button" data-testid={`button-preset-${p.key}`} onClick={() => setPreset(p.key)}
                  className={cn("rounded-lg border p-3 text-start transition-colors", preset === p.key ? "border-blue-500 bg-blue-50/70 ring-1 ring-blue-500" : "border-slate-200 hover:border-slate-300")}>
                  <div className="mb-1 flex items-center gap-2 text-sm font-medium text-slate-800">{p.icon}{p.title}</div>
                  <div className="text-xs leading-snug text-slate-500">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{t("common.cancel", "Отмена")}</Button>
          <Button data-testid="button-create-template" onClick={() => void submit()} disabled={busy || !name.trim() || entityId == null}>
            {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("cards.createDraft", "Создать черновик")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DuplicateDialog({ source, onClose, entities, pages }: { source: CardTemplate | null; onClose: () => void; entities: Entity[]; pages: Page[] }) {
  const t = useT();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [entityId, setEntityId] = useState<number | null>(null);
  const [pageId, setPageId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (source) { setName(`${source.name} (${t("cards.copySuffix", "копия")})`); setEntityId(source.entityId); setPageId(source.pageId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id]);
  const crossEntity = source != null && entityId != null && entityId !== source.entityId;
  const submit = async () => {
    if (!source || entityId == null || !name.trim()) return;
    const parsed = parseCardLayout(source.layout);
    if (!parsed) { toast({ variant: "destructive", title: t("cards.invalidLayout", "Макет карточки повреждён") }); return; }
    setBusy(true);
    try {
      const created = await createCardTemplate({ name: name.trim(), entityId, pageId, layout: asInput(copyLayout(parsed, !crossEntity)) });
      await qc.invalidateQueries({ queryKey: getListCardTemplatesQueryKey() });
      onClose();
      navigate(`/admin/card-templates/${created.id}`);
    } catch (e) {
      toast({ variant: "destructive", title: t("cards.copyFailed", "Не удалось скопировать"), description: errMessage(e) });
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!source} onOpenChange={o => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-w-lg" data-testid="dialog-duplicate">
        <DialogHeader>
          <DialogTitle>{t("cards.copyTitle", "Копировать карточку")}</DialogTitle>
          <DialogDescription>{t("cards.copyDesc", "Копия создаётся как черновик. Вкладки, разделы, тексты, разделители и оформление сохраняются.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("cards.name", "Название")}</Label>
            <Input data-testid="input-copy-name" value={name} onChange={e => setName(e.target.value)} maxLength={200} />
          </div>
          <EntityPageFields entityId={entityId} pageId={pageId} onEntity={setEntityId} onPage={setPageId} entities={entities} pages={pages} />
          {crossEntity && (
            <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" data-testid="text-cross-entity">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {t("cards.copyCrossEntity", "Другая сущность: привязки полей и столбцы таблиц будут очищены. Пустые ячейки останутся на своих местах — перетащите в них нужные поля.")}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>{t("common.cancel", "Отмена")}</Button>
          <Button data-testid="button-confirm-copy" onClick={() => void submit()} disabled={busy || !name.trim() || entityId == null}>
            {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" />}{t("cards.copyConfirm", "Создать копию")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
function TemplateList() {
  const t = useT();
  const ml = useML();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: templates = [], isLoading, isError, error, refetch } = useListCardTemplates();
  const { data: entities = [] } = useListEntities();
  const { data: pages = [] } = useListPages();
  const [createOpen, setCreateOpen] = useState(false);
  const [copySource, setCopySource] = useState<CardTemplate | null>(null);
  const [toDelete, setToDelete] = useState<CardTemplate | null>(null);
  const [filterEntity, setFilterEntity] = useState<string>("all");
  const flow = usePublishFlow(() => undefined);
  const refresh = () => qc.invalidateQueries({ queryKey: getListCardTemplatesQueryKey() });

  const unpublish = async (tpl: CardTemplate) => {
    try { await unpublishCardTemplate(tpl.id, { expectedRevision: tpl.revision }); toast({ title: t("cards.unpublished", "Карточка снята с публикации") }); }
    catch (e) { toast({ variant: "destructive", title: t("cards.unpublishFailed", "Не удалось снять с публикации"), description: errMessage(e) }); }
    finally { void refresh(); }
  };
  const remove = async (tpl: CardTemplate) => {
    try { await deleteCardTemplate(tpl.id); toast({ title: t("cards.deleted", "Черновик удалён") }); }
    catch (e) { toast({ variant: "destructive", title: t("cards.deleteFailed", "Не удалось удалить"), description: errMessage(e) }); }
    finally { setToDelete(null); void refresh(); }
  };

  const groups = useMemo(() => {
    const list = templates.filter(x => filterEntity === "all" || String(x.entityId) === filterEntity);
    const m = new Map<number, CardTemplate[]>();
    for (const x of list) m.set(x.entityId, [...(m.get(x.entityId) ?? []), x]);
    for (const arr of m.values()) arr.sort((a, b) => (a.pageId ?? -1) - (b.pageId ?? -1) || (a.state === "published" ? -1 : 1) || a.name.localeCompare(b.name));
    return [...m.entries()];
  }, [templates, filterEntity]);
  const pageName = (id: number | null) => id == null ? null : ml(pages.find(p => p.id === id)?.nameJson) || `#${id}`;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-blue-600">
            <LayoutTemplate className="h-3.5 w-3.5" />{t("cards.kicker", "Конструктор")}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{t("cards.title", "Карточки записей")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {t("cards.subtitle", "Расположение полей в формах просмотра, создания и редактирования. Права доступа к полям и блокировки продолжают действовать как обычно.")}
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={filterEntity} onValueChange={setFilterEntity}>
            <SelectTrigger className="w-48" data-testid="select-filter-entity"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("cards.allEntities", "Все сущности")}</SelectItem>
              {entities.map(e => <SelectItem key={e.id} value={String(e.id)}>{ml(e.nameJson)}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button data-testid="button-new-template" onClick={() => setCreateOpen(true)} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="me-1.5 h-4 w-4" />{t("cards.new", "Новая карточка")}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : isError ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {t("cards.loadError", "Не удалось загрузить карточки.")} {errMessage(error)}{" "}
          <button type="button" className="underline" onClick={() => void refetch()}>{t("common.retry", "Повторить")}</button>
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center" data-testid="empty-templates">
          <div className="mb-4 grid grid-cols-3 gap-1 opacity-70">
            {[2, 1, 1, 3, 1, 2].map((w, i) => <div key={i} className="h-2 rounded bg-slate-200" style={{ width: w * 14 }} />)}
          </div>
          <h2 className="font-semibold text-slate-800">{t("cards.emptyTitle", "Карточек пока нет")}</h2>
          <p className="mt-1 max-w-sm text-sm text-slate-500">{t("cards.emptyDesc", "Пока карточка не опубликована, все формы используют стандартный вид ERP.")}</p>
          <Button className="mt-5" variant="outline" onClick={() => setCreateOpen(true)}><Plus className="me-1.5 h-4 w-4" />{t("cards.new", "Новая карточка")}</Button>
        </div>
      ) : (
        groups.map(([entityId, list]) => (
          <section key={entityId} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <header className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
              <h2 className="text-sm font-semibold text-slate-700">{ml(entities.find(e => e.id === entityId)?.nameJson) || `#${entityId}`}</h2>
              <span className="text-xs text-slate-400">{list.length}</span>
            </header>
            <ul className="divide-y divide-slate-100">
              {list.map(tpl => (
                <li key={tpl.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center" data-testid={`row-template-${tpl.id}`}>
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/card-templates/${tpl.id}`} className="font-medium text-slate-900 hover:text-blue-700" data-testid={`link-template-${tpl.id}`}>{tpl.name}</Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <StateBadge state={tpl.state} />
                      <span>{tpl.pageId == null ? t("cards.scopeEntityShort", "Сущность по умолчанию") : `${t("cards.scopePage", "Только страница")}: ${pageName(tpl.pageId)}`}</span>
                      <span className="text-slate-300">·</span>
                      <span>{t("cards.revision", "Ревизия")} {tpl.revision}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/admin/card-templates/${tpl.id}`}><Pencil className="me-1 h-3.5 w-3.5" />{tpl.state === "draft" ? t("cards.edit", "Изменить") : t("cards.open", "Открыть")}</Link>
                    </Button>
                    <Button size="sm" variant="ghost" data-testid={`button-copy-${tpl.id}`} onClick={() => setCopySource(tpl)}><Copy className="me-1 h-3.5 w-3.5" />{t("cards.copy", "Копировать")}</Button>
                    {tpl.state === "draft" ? (
                      <>
                        <Button size="sm" variant="outline" data-testid={`button-publish-${tpl.id}`} disabled={flow.busy} onClick={() => void flow.publish(tpl)}>
                          <Rocket className="me-1 h-3.5 w-3.5" />{t("cards.publish", "Опубликовать")}
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700" data-testid={`button-delete-${tpl.id}`} onClick={() => setToDelete(tpl)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" data-testid={`button-unpublish-${tpl.id}`} onClick={() => void unpublish(tpl)}>
                        <Undo2 className="me-1 h-3.5 w-3.5" />{t("cards.unpublish", "Снять с публикации")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <CreateDialog open={createOpen} onOpenChange={setCreateOpen} entities={entities} pages={pages} />
      <DuplicateDialog source={copySource} onClose={() => setCopySource(null)} entities={entities} pages={pages} />
      {flow.dialog(entities)}
      <AlertDialog open={!!toDelete} onOpenChange={o => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cards.deleteTitle", "Удалить черновик?")}</AlertDialogTitle>
            <AlertDialogDescription>{toDelete?.name}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" data-testid="button-confirm-delete" onClick={() => toDelete && void remove(toDelete)}>
              {t("common.delete", "Удалить")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
type DragPayload = { type: "field"; fieldKey: string; kind: "field" | "relatedTable" } | { type: "kind"; kind: CardBlockKind } | { type: "block"; blockId: string };
const DND_MIME = "application/x-erp-card";
type Selection = { type: "block"; id: string } | { type: "section"; id: string } | { type: "tab"; id: string } | { type: "style" };

function TemplateEditor({ id }: { id: number }) {
  const t = useT();
  const ml = useML();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data: templates = [], isLoading, isError, error, refetch } = useListCardTemplates();
  const template = templates.find(x => x.id === id);
  const { data: entities = [] } = useListEntities();
  const { data: pages = [] } = useListPages();
  const entityId = template?.entityId ?? 0;
  const { data: fields = [] } = useListEntityFields(entityId, { query: { enabled: !!template, queryKey: getListEntityFieldsQueryKey(entityId) } });
  const { data: relations = [] } = useListEntityRelations(entityId, { query: { enabled: !!template, queryKey: [`/api/entities/${entityId}/relations`] } });

  const [layout, setLayout] = useState<CardLayout | null>(null);
  const [name, setName] = useState("");
  const [pageId, setPageId] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [staleConflict, setStaleConflict] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("");
  const [selection, setSelection] = useState<Selection>({ type: "style" });
  const [previewMode, setPreviewMode] = useState<CardMode | "all">("all");
  const [dropHint, setDropHint] = useState<string | null>(null);
  const initFor = useRef<string | null>(null);

  // Initialize local editing state once per template id+revision; never clobber
  // unsaved local edits when the list refetches.
  useEffect(() => {
    if (!template) return;
    const key = `${template.id}:${template.revision}`;
    if (initFor.current === key || (dirty && initFor.current?.startsWith(`${template.id}:`))) return;
    initFor.current = key;
    const parsed = parseCardLayout(template.layout);
    setLayout(parsed);
    setName(template.name);
    setPageId(template.pageId);
    setDirty(false);
    setStaleConflict(false);
    if (parsed && !parsed.tabs.some(tb => tb.id === activeTab)) setActiveTab(parsed.tabs[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id, template?.revision]);

  const flow = usePublishFlow(() => undefined);
  const readOnly = template?.state === "published";
  const fieldByKey = useMemo(() => new Map(fields.map(f => [f.fieldKey, f])), [fields]);
  const bound = useMemo(() => layout ? boundFieldKeys(layout) : new Set<string>(), [layout]);
  const issues = useMemo(() => layout ? layoutIssues(layout, fields) : [], [layout, fields]);

  const change = (fn: (l: CardLayout) => CardLayout) => {
    if (readOnly) return;
    setLayout(l => l ? fn(l) : l);
    setDirty(true);
  };

  const save = async (): Promise<CardTemplate | null> => {
    if (!template || !layout) return null;
    setSaving(true);
    try {
      const updated = await updateCardTemplate(template.id, { name: name.trim() || template.name, entityId: template.entityId, pageId, layout: asInput(layout), expectedRevision: template.revision });
      initFor.current = `${updated.id}:${updated.revision}`;
      qc.setQueryData<CardTemplate[]>(getListCardTemplatesQueryKey(), old => old?.map(x => x.id === updated.id ? updated : x));
      setDirty(false);
      toast({ title: t("cards.saved", "Черновик сохранён") });
      return updated;
    } catch (e) {
      if (errStatus(e) === 409) setStaleConflict(true);
      toast({ variant: "destructive", title: t("cards.saveFailed", "Не удалось сохранить"), description: errMessage(e) });
      return null;
    } finally { setSaving(false); }
  };
  const saveThenPublish = async () => {
    const current = dirty ? await save() : template ?? null;
    if (current) await flow.publish(current);
  };
  const reloadServer = () => { initFor.current = null; setDirty(false); void refetch().then(() => setStaleConflict(false)); };
  const copyToDraft = async () => {
    if (!template || !layout) return;
    try {
      const created = await createCardTemplate({ name: `${template.name} (${t("cards.draftSuffix", "черновик")})`, entityId: template.entityId, pageId: template.pageId, layout: asInput(copyLayout(layout, true)) });
      await qc.invalidateQueries({ queryKey: getListCardTemplatesQueryKey() });
      navigate(`/admin/card-templates/${created.id}`);
    } catch (e) { toast({ variant: "destructive", title: t("cards.copyFailed", "Не удалось скопировать"), description: errMessage(e) }); }
  };
  const unpublish = async () => {
    if (!template) return;
    try { await unpublishCardTemplate(template.id, { expectedRevision: template.revision }); toast({ title: t("cards.unpublished", "Карточка снята с публикации") }); }
    catch (e) { toast({ variant: "destructive", title: t("cards.unpublishFailed", "Не удалось снять с публикации"), description: errMessage(e) }); }
    finally { void qc.invalidateQueries({ queryKey: getListCardTemplatesQueryKey() }); }
  };

  // ---- drag & drop ----
  const readPayload = (e: DragEvent): DragPayload | null => {
    try { return JSON.parse(e.dataTransfer.getData(DND_MIME)) as DragPayload; } catch { return null; }
  };
  const startDrag = (e: DragEvent, p: DragPayload) => {
    if (readOnly) { e.preventDefault(); return; }
    e.dataTransfer.setData(DND_MIME, JSON.stringify(p));
    e.dataTransfer.effectAllowed = "move";
  };
  const dropAt = (e: DragEvent, sectionId: string, index: number, targetBlock?: CardBlock) => {
    e.preventDefault();
    e.stopPropagation();
    setDropHint(null);
    const p = readPayload(e);
    if (!p || readOnly) return;
    if (p.type === "block") { change(l => moveBlock(l, p.blockId, sectionId, index)); setSelection({ type: "block", id: p.blockId }); return; }
    if (p.type === "field" && targetBlock && (targetBlock.kind === "field" || targetBlock.kind === "relatedTable") && !targetBlock.fieldKey) {
      // Fill an empty slot in place (keeps the slot's span, modes and label).
      change(l => updateBlock(l, targetBlock.id, { fieldKey: p.fieldKey, kind: p.kind, columns: [] }));
      setSelection({ type: "block", id: targetBlock.id });
      return;
    }
    const block = p.type === "field" ? makeBlock(p.kind, p.fieldKey) : makeBlock(p.kind);
    change(l => insertBlock(l, sectionId, index, block));
    setSelection({ type: "block", id: block.id });
  };
  const allowDrop = (e: DragEvent, hint: string) => { if (readOnly) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dropHint !== hint) setDropHint(hint); };

  const addToActive = (block: CardBlock) => {
    if (!layout) return;
    const tab = layout.tabs.find(x => x.id === activeTab) ?? layout.tabs[0];
    let sec = selection.type === "section" ? tab.sections.find(s => s.id === selection.id) : undefined;
    if (!sec && selection.type === "block") { const loc = findBlock(layout, selection.id); sec = tab.sections.find(s => s.id === loc?.sectionId); }
    sec = sec ?? tab.sections[tab.sections.length - 1];
    if (!sec) {
      const newSec: CardSection = { id: newId("sec"), title: {}, columns: 1, blocks: [block] };
      change(l => ({ ...l, tabs: l.tabs.map(x => x.id === tab.id ? { ...x, sections: [...x.sections, newSec] } : x) }));
    } else {
      const target = sec;
      change(l => insertBlock(l, target.id, target.blocks.length, block));
    }
    setSelection({ type: "block", id: block.id });
  };

  if (isLoading) return <div className="space-y-3 p-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-[60vh] w-full" /></div>;
  if (isError) return (
    <div role="alert" className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {errMessage(error)} <button type="button" className="underline" onClick={() => void refetch()}>{t("common.retry", "Повторить")}</button>
    </div>
  );
  if (!template) return (
    <div className="m-6 rounded-lg border border-slate-200 bg-white p-8 text-center">
      <p className="text-slate-600">{t("cards.notFound", "Карточка не найдена")}</p>
      <Button asChild variant="outline" className="mt-4"><Link href="/admin/card-templates">{t("cards.backToList", "К списку")}</Link></Button>
    </div>
  );
  if (!layout) return (
    <div role="alert" className="m-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{t("cards.invalidLayout", "Макет карточки повреждён")}</div>
  );

  const tab = layout.tabs.find(x => x.id === activeTab) ?? layout.tabs[0];
  const appearance = cardAppearance(layout);
  const entity = entities.find(e => e.id === template.entityId);
  const relationFields = fields.filter(f => f.fieldType === "relation" && f.isActive);
  const selectedBlock = selection.type === "block" ? findBlock(layout, selection.id)?.block : undefined;
  const selectedSection = selection.type === "section" ? layout.tabs.flatMap(x => x.sections).find(s => s.id === selection.id) : undefined;
  const selectedTab = selection.type === "tab" ? layout.tabs.find(x => x.id === selection.id) : undefined;
  const issueLabel = (i: (typeof issues)[number]) => {
    const fname = i.fieldKey ? ml(fieldByKey.get(i.fieldKey)?.nameJson) || i.fieldKey : "";
    switch (i.kind) {
      case "emptySlot": return t("cards.issueEmptySlot", "Пустая ячейка без поля");
      case "unknownField": return `${t("cards.issueUnknown", "Поле не найдено в сущности")}: ${fname}`;
      case "duplicate": return `${t("cards.issueDuplicate", "Поле размещено несколько раз")}: ${fname}`;
      case "requiredMissing": return `${t("cards.issueRequired", "Обязательное поле отсутствует в режиме создания")}: ${fname}`;
    }
  };

  const blockTitle = (b: CardBlock) => {
    if (b.kind === "text") return ml(b.text) || t("cards.blockText", "Текст");
    if (b.kind === "divider") return ml(b.label) || t("cards.blockDivider", "Разделитель");
    if (!b.fieldKey) return t("cards.emptySlot", "Пустая ячейка — перетащите поле");
    const f = fieldByKey.get(b.fieldKey);
    return ml(b.label) || ml(f?.nameJson) || b.fieldKey;
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-slate-100/60">
      {/* Top bar */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur">
        <Button asChild size="icon" variant="ghost" className="h-8 w-8"><Link href="/admin/card-templates" aria-label={t("cards.backToList", "К списку")}><ArrowLeft className="h-4 w-4 rtl:rotate-180" /></Link></Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Input data-testid="input-editor-name" value={name} disabled={readOnly} onChange={e => { setName(e.target.value); setDirty(true); }}
              className="h-8 max-w-sm border-transparent px-1.5 text-base font-semibold shadow-none hover:border-slate-200 focus-visible:border-slate-300" />
            <StateBadge state={template.state} />
            {dirty && <span className="text-xs text-amber-600" data-testid="text-dirty">{t("cards.unsaved", "Есть несохранённые изменения")}</span>}
          </div>
          <div className="px-1.5 text-xs text-slate-500">{ml(entity?.nameJson)} · {t("cards.revision", "Ревизия")} {template.revision}</div>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5" role="group" aria-label={t("cards.previewMode", "Режим предпросмотра")}>
          {(["all", ...CARD_MODES] as const).map(m => (
            <button key={m} type="button" data-testid={`button-preview-${m}`} onClick={() => setPreviewMode(m)}
              className={cn("rounded px-2 py-1 text-xs font-medium", previewMode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>
              {m === "all" ? t("cards.modeAll", "Все") : m === "view" ? t("cards.modeView", "Просмотр") : m === "create" ? t("cards.modeCreate", "Создание") : t("cards.modeEdit", "Изменение")}
            </button>
          ))}
        </div>
        {readOnly ? (
          <>
            <Button size="sm" variant="outline" data-testid="button-copy-to-draft" onClick={() => void copyToDraft()}><Copy className="me-1.5 h-3.5 w-3.5" />{t("cards.copyToDraft", "Копировать в черновик")}</Button>
            <Button size="sm" variant="outline" data-testid="button-editor-unpublish" onClick={() => void unpublish()}><Undo2 className="me-1.5 h-3.5 w-3.5" />{t("cards.unpublish", "Снять с публикации")}</Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" data-testid="button-save-draft" disabled={saving || !dirty} onClick={() => void save()}>
              {saving ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="me-1.5 h-3.5 w-3.5" />}{t("cards.saveDraft", "Сохранить черновик")}
            </Button>
            <Button size="sm" data-testid="button-editor-publish" className="bg-blue-600 hover:bg-blue-700" disabled={saving || flow.busy || staleConflict} onClick={() => void saveThenPublish()}>
              <Rocket className="me-1.5 h-3.5 w-3.5" />{t("cards.publish", "Опубликовать")}
            </Button>
          </>
        )}
      </div>

      {readOnly && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800" data-testid="text-published-readonly">
          {t("cards.publishedReadonly", "Опубликованная карточка не изменяется. Чтобы внести правки, скопируйте её в черновик и опубликуйте с заменой.")}
        </div>
      )}
      {staleConflict && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
          {t("cards.staleConflict", "Карточка изменена в другом окне. Ваши правки сохранены здесь, но не на сервере.")}
          <Button size="sm" variant="outline" className="h-7" onClick={reloadServer}>{t("cards.reloadServer", "Загрузить серверную версию (правки будут отброшены)")}</Button>
        </div>
      )}

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[240px_minmax(0,1fr)_300px]">
        {/* Palette */}
        <aside className="space-y-4 lg:sticky lg:top-16 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto">
          <PaletteGroup title={t("cards.paletteBlocks", "Элементы")}>
            {([
              ["text", <Type key="i" className="h-3.5 w-3.5" />, t("cards.blockText", "Текст")],
              ["divider", <Minus key="i" className="h-3.5 w-3.5" />, t("cards.blockDivider", "Разделитель")],
              ["field", <Square key="i" className="h-3.5 w-3.5" />, t("cards.blockSlot", "Пустая ячейка")],
            ] as [CardBlockKind, ReactNode, string][]).map(([kind, icon, label]) => (
              <PaletteItem key={kind} testId={`palette-kind-${kind}`} icon={icon} label={label} disabled={readOnly}
                onDragStart={e => startDrag(e, { type: "kind", kind })} onAdd={() => addToActive(makeBlock(kind))} />
            ))}
          </PaletteGroup>
          <PaletteGroup title={t("cards.paletteFields", "Поля")} count={fields.filter(f => f.isActive).length}>
            {fields.filter(f => f.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map(f => (
              <PaletteItem key={f.id} testId={`palette-field-${f.fieldKey}`} icon={<GripVertical className="h-3.5 w-3.5" />}
                label={ml(f.nameJson) || f.fieldKey} placed={bound.has(f.fieldKey)} required={f.isRequired} disabled={readOnly}
                onDragStart={e => startDrag(e, { type: "field", fieldKey: f.fieldKey, kind: "field" })}
                onAdd={() => addToActive(makeBlock("field", f.fieldKey))} />
            ))}
          </PaletteGroup>
          {relationFields.length > 0 && (
            <PaletteGroup title={t("cards.paletteTables", "Таблицы связанных записей")}>
              {relationFields.map(f => (
                <PaletteItem key={f.id} testId={`palette-table-${f.fieldKey}`} icon={<Table2 className="h-3.5 w-3.5" />}
                  label={ml(f.nameJson) || f.fieldKey} placed={bound.has(f.fieldKey)} disabled={readOnly}
                  onDragStart={e => startDrag(e, { type: "field", fieldKey: f.fieldKey, kind: "relatedTable" })}
                  onAdd={() => addToActive(makeBlock("relatedTable", f.fieldKey))} />
              ))}
            </PaletteGroup>
          )}
        </aside>

        {/* Canvas */}
        <main className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-1 border-b border-slate-200">
            {layout.tabs.map((tb, i) => (
              <button key={tb.id} type="button" data-testid={`editor-tab-${i}`}
                onClick={() => { setActiveTab(tb.id); setSelection({ type: "tab", id: tb.id }); }}
                className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors", tb.id === tab.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800")}>
                {mlIsEmpty(tb.title) ? `${t("cards.tab", "Вкладка")} ${i + 1}` : ml(tb.title)}
              </button>
            ))}
            {!readOnly && layout.tabs.length < 20 && (
              <button type="button" data-testid="button-add-tab" className="ms-1 flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-white hover:text-slate-800"
                onClick={() => {
                  const nt = { id: newId("tab"), title: { ru: "Новая вкладка", en: "New tab", he: "לשונית חדשה" }, sections: [{ id: newId("sec"), title: {}, columns: 1, blocks: [] }] };
                  change(l => ({ ...l, tabs: [...l.tabs, nt] }));
                  setActiveTab(nt.id); setSelection({ type: "tab", id: nt.id });
                }}>
                <Plus className="h-3.5 w-3.5" />{t("cards.addTab", "Вкладка")}
              </button>
            )}
          </div>

          <div data-testid="editor-card-preview" data-card-style={layout.style}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            style={{ ...appearance.root, ...appearance.sections }}>
            {tab.sections.length === 0 && <p className="py-8 text-center text-sm text-slate-400">{t("cards.noSections", "На вкладке нет разделов")}</p>}
            {tab.sections.map((sec, si) => {
              const cols = sec.columns;
              const selected = selection.type === "section" && selection.id === sec.id;
              return (
                <div key={sec.id} data-testid={`editor-section-${si}`}
                  style={appearance.section}
                  className={cn("rounded-lg border p-3 transition-colors", selected ? "border-blue-400 bg-blue-50/30" : "border-dashed border-slate-300")}>
                  <div className="mb-2 flex items-center gap-2">
                    <button type="button" style={appearance.heading} className="min-w-0 flex-1 truncate text-start text-sm font-semibold text-slate-700" onClick={() => setSelection({ type: "section", id: sec.id })} data-testid={`button-select-section-${si}`}>
                      {ml(sec.title) || <span className="font-normal italic text-slate-400">{t("cards.untitledSection", "Раздел без заголовка")}</span>}
                    </button>
                    {!readOnly && (
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3].map(n => (
                          <button key={n} type="button" data-testid={`button-section-cols-${si}-${n}`} title={`${n}`}
                            onClick={() => change(l => ({ ...l, tabs: l.tabs.map(x => ({ ...x, sections: x.sections.map(s => s.id === sec.id ? { ...s, columns: n } : s) })) }))}
                            className={cn("h-6 w-6 rounded text-xs font-medium", cols === n ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100")}>{n}</button>
                        ))}
                        <IconBtn label={t("cards.up", "Выше")} disabled={si === 0} onClick={() => change(l => ({ ...l, tabs: l.tabs.map(x => x.id === tab.id ? { ...x, sections: moveItem(x.sections, si, -1) } : x) }))}><ArrowUp className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn label={t("cards.down", "Ниже")} disabled={si === tab.sections.length - 1} onClick={() => change(l => ({ ...l, tabs: l.tabs.map(x => x.id === tab.id ? { ...x, sections: moveItem(x.sections, si, 1) } : x) }))}><ArrowDown className="h-3.5 w-3.5" /></IconBtn>
                        <IconBtn label={t("common.delete", "Удалить")} danger onClick={() => change(l => ({ ...l, tabs: l.tabs.map(x => x.id === tab.id ? { ...x, sections: x.sections.filter(s => s.id !== sec.id) } : x) }))}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                      </div>
                    )}
                  </div>
                  <div data-testid={`editor-section-grid-${si}`} className={cn("grid", SECTION_GRID[cols])} style={appearance.grid}
                    onDragOver={e => allowDrop(e, `${sec.id}:end`)} onDragLeave={() => setDropHint(null)}
                    onDrop={e => dropAt(e, sec.id, sec.blocks.length)}>
                    {sec.blocks.map((b, bi) => {
                      const dim = previewMode !== "all" && !b.modes.includes(previewMode);
                      const isSel = selection.type === "block" && selection.id === b.id;
                      const empty = (b.kind === "field" || b.kind === "relatedTable") && !b.fieldKey;
                      const missing = !!b.fieldKey && !fieldByKey.has(b.fieldKey) && fields.length > 0;
                      return (
                        <div key={b.id} draggable={!readOnly} data-testid={`editor-block-${b.id}`}
                          onDragStart={e => startDrag(e, { type: "block", blockId: b.id })}
                          onDragOver={e => allowDrop(e, b.id)} onDrop={e => dropAt(e, sec.id, bi, b)}
                          onClick={() => setSelection({ type: "block", id: b.id })}
                          className={cn(
                            "group relative flex min-h-[52px] cursor-pointer items-start gap-2 rounded-md border bg-white px-2.5 py-2 text-sm transition",
                            BLOCK_SPAN[Math.min(cols, b.span)],
                            isSel ? "border-blue-500 ring-1 ring-blue-500" : "border-slate-200 hover:border-slate-300",
                            empty && "border-dashed border-amber-300 bg-amber-50/40",
                            missing && "border-red-300 bg-red-50/40",
                            dim && "opacity-35",
                            dropHint === b.id && "before:absolute before:-top-1 before:inset-x-0 before:h-0.5 before:rounded before:bg-blue-500",
                          )}>
                          {!readOnly && <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-grab text-slate-300 group-hover:text-slate-500" />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                              {b.kind === "relatedTable" ? <Table2 className="h-3 w-3" /> : b.kind === "text" ? <FileText className="h-3 w-3" /> : b.kind === "divider" ? <Minus className="h-3 w-3" /> : null}
                              {b.kind === "field" ? t("cards.kindField", "Поле") : b.kind === "relatedTable" ? t("cards.kindTable", "Таблица") : b.kind === "text" ? t("cards.kindText", "Текст") : t("cards.kindDivider", "Разделитель")}
                              {b.modes.length < 3 && <span className="normal-case text-slate-400">· {b.modes.join("/")}</span>}
                            </div>
                            <div className={cn("truncate", empty ? "text-amber-700" : missing ? "text-red-700" : "text-slate-800", b.kind === "text" && "whitespace-pre-wrap line-clamp-2")}>
                              {blockTitle(b)}
                              {b.fieldKey && fieldByKey.get(b.fieldKey)?.isRequired && <span className="ms-0.5 text-red-500">*</span>}
                            </div>
                            {b.kind === "relatedTable" && b.columns.length > 0 && (
                              <div className="mt-1 truncate text-xs text-slate-400">{b.columns.length} {t("cards.columnsCount", "столбцов")}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div className={cn("flex min-h-[40px] items-center justify-center rounded-md border border-dashed text-xs text-slate-400", BLOCK_SPAN[cols], dropHint === `${sec.id}:end` ? "border-blue-400 bg-blue-50 text-blue-600" : "border-slate-200")}>
                      {readOnly ? "" : t("cards.dropHere", "Перетащите поле или элемент сюда")}
                    </div>
                  </div>
                </div>
              );
            })}
            {!readOnly && tab.sections.length < 30 && (
              <Button variant="outline" size="sm" data-testid="button-add-section" className="w-full border-dashed"
                onClick={() => {
                  const ns: CardSection = { id: newId("sec"), title: {}, columns: 2, blocks: [] };
                  change(l => ({ ...l, tabs: l.tabs.map(x => x.id === tab.id ? { ...x, sections: [...x.sections, ns] } : x) }));
                  setSelection({ type: "section", id: ns.id });
                }}>
                <Plus className="me-1.5 h-3.5 w-3.5" />{t("cards.addSection", "Добавить раздел")}
              </Button>
            )}
          </div>

          {issues.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="list-issues">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-900"><AlertTriangle className="h-3.5 w-3.5" />{t("cards.issuesTitle", "Перед публикацией")}</div>
              <ul className="space-y-0.5 text-xs text-amber-800">
                {issues.slice(0, 12).map((i, idx) => (
                  <li key={idx}>
                    {i.blockId ? <button type="button" className="text-start underline-offset-2 hover:underline" onClick={() => setSelection({ type: "block", id: i.blockId! })}>{issueLabel(i)}</button> : issueLabel(i)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </main>

        {/* Inspector */}
        <aside className="space-y-3 lg:sticky lg:top-16 lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto">
          <div className="flex gap-1 rounded-md bg-slate-200/60 p-0.5 text-xs">
            <button type="button" data-testid="button-inspector-style" onClick={() => setSelection({ type: "style" })}
              className={cn("flex-1 rounded px-2 py-1 font-medium", selection.type === "style" ? "bg-white shadow-sm" : "text-slate-600")}>{t("cards.styleAndScope", "Оформление")}</button>
            <button type="button" onClick={() => setSelection({ type: "tab", id: tab.id })}
              className={cn("flex-1 rounded px-2 py-1 font-medium", selection.type !== "style" ? "bg-white shadow-sm" : "text-slate-600")}>{t("cards.element", "Элемент")}</button>
          </div>
          <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
            {selection.type === "style" && (
              <StylePanel layout={layout} readOnly={readOnly} onChange={change}
                scope={<EntityPageFields entityId={template.entityId} pageId={pageId} lockEntity onEntity={() => undefined}
                  onPage={p => { if (!readOnly) { setPageId(p); setDirty(true); } }} entities={entities} pages={pages} />} />
            )}
            {selectedTab && (
              <fieldset disabled={readOnly} className="space-y-3">
                <MultilingualInput label={t("cards.tabTitle", "Название вкладки")} value={selectedTab.title}
                  onChange={v => change(l => ({ ...l, tabs: l.tabs.map(x => x.id === selectedTab.id ? { ...x, title: v } : x) }))} />
                <div className="flex gap-1.5">
                  {(() => { const idx = layout.tabs.findIndex(x => x.id === selectedTab.id); return (<>
                    <Button size="sm" variant="outline" disabled={idx === 0} onClick={() => change(l => ({ ...l, tabs: moveItem(l.tabs, idx, -1) }))}><ArrowUp className="h-3.5 w-3.5 rtl:-rotate-90 -rotate-90" /></Button>
                    <Button size="sm" variant="outline" disabled={idx === layout.tabs.length - 1} onClick={() => change(l => ({ ...l, tabs: moveItem(l.tabs, idx, 1) }))}><ArrowDown className="h-3.5 w-3.5 -rotate-90" /></Button>
                  </>); })()}
                  <Button size="sm" variant="outline" className="ms-auto text-red-600" data-testid="button-delete-tab" disabled={layout.tabs.length <= 1}
                    onClick={() => { const rest = layout.tabs.filter(x => x.id !== selectedTab.id); change(l => ({ ...l, tabs: l.tabs.filter(x => x.id !== selectedTab.id) })); setActiveTab(rest[0].id); setSelection({ type: "style" }); }}>
                    <Trash2 className="me-1 h-3.5 w-3.5" />{t("cards.deleteTab", "Удалить вкладку")}
                  </Button>
                </div>
              </fieldset>
            )}
            {selectedSection && (
              <fieldset disabled={readOnly} className="space-y-3">
                <MultilingualInput label={t("cards.sectionTitle", "Заголовок раздела")} value={selectedSection.title}
                  onChange={v => change(l => ({ ...l, tabs: l.tabs.map(x => ({ ...x, sections: x.sections.map(s => s.id === selectedSection.id ? { ...s, title: v } : s) })) }))} />
                <p className="text-xs text-slate-500">{t("cards.sectionColsHint", "Количество колонок задаётся кнопками 1/2/3 в заголовке раздела. На телефоне всегда одна колонка.")}</p>
              </fieldset>
            )}
            {selectedBlock && (
              <BlockInspector block={selectedBlock} readOnly={readOnly} fields={fields} relations={relations} entityId={template.entityId}
                onPatch={patch => change(l => updateBlock(l, selectedBlock.id, patch))}
                onRemove={() => { change(l => removeBlock(l, selectedBlock.id)); setSelection({ type: "style" }); }} />
            )}
            {selection.type === "block" && !selectedBlock && <p className="text-sm text-slate-400">{t("cards.nothingSelected", "Выберите элемент на холсте")}</p>}
          </div>
        </aside>
      </div>
      {flow.dialog(entities)}
    </div>
  );
}

function PaletteGroup({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        <span>{title}</span>{count != null && <span className="text-slate-400">{count}</span>}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function PaletteItem({ icon, label, onDragStart, onAdd, placed, required, disabled, testId }: {
  icon: ReactNode; label: string; onDragStart: (e: DragEvent) => void; onAdd: () => void; placed?: boolean; required?: boolean; disabled?: boolean; testId: string;
}) {
  const t = useT();
  return (
    <div draggable={!disabled} onDragStart={onDragStart} data-testid={testId}
      className={cn("group flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-sm", disabled ? "opacity-60" : "cursor-grab hover:border-blue-300 hover:shadow-sm", placed ? "border-slate-100 text-slate-400" : "border-slate-200 text-slate-700")}>
      <span className="shrink-0 text-slate-400">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}{required && <span className="ms-0.5 text-red-500">*</span>}</span>
      {placed && <span className="text-[10px] uppercase text-slate-400">{t("cards.placed", "в карточке")}</span>}
      {!disabled && (
        <button type="button" onClick={onAdd} aria-label={t("cards.addToCard", "Добавить в карточку")} data-testid={`${testId}-add`}
          className="rounded p-0.5 text-slate-400 opacity-0 hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 focus:opacity-100">
          <Plus className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function IconBtn({ children, label, onClick, disabled, danger }: { children: ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
      className={cn("rounded p-1 disabled:opacity-30", danger ? "text-red-500 hover:bg-red-50" : "text-slate-500 hover:bg-slate-100")}>{children}</button>
  );
}

function StylePanel({ layout, readOnly, onChange, scope }: { layout: CardLayout; readOnly: boolean; onChange: (fn: (l: CardLayout) => CardLayout) => void; scope: ReactNode }) {
  const t = useT();
  const styles: { key: CardStyle; label: string }[] = [
    { key: "standard", label: t("cards.presetStandard", "Стандартный") },
    { key: "compact", label: t("cards.presetCompact", "Компактный") },
    { key: "sectioned", label: t("cards.presetSectioned", "Разделы") },
    { key: "custom", label: t("cards.styleCustom", "Свой") },
  ];
  const c = layout.customStyle;
  const setC = (patch: Partial<CardLayout["customStyle"]>) => onChange(l => ({ ...l, customStyle: { ...l.customStyle, ...patch } }));
  const color = (key: "background" | "sectionBackground" | "accent", label: string) => (
    <div data-testid={`input-style-${key}`}>
      <ColorPickerControl label={label} value={c[key] ?? ""} onChange={value => setC({ [key]: value || undefined })} />
    </div>
  );
  const range = (key: "spacing" | "radius" | "fontSize", label: string, min: number, max: number) => (
    <div className="space-y-1">
      <div className="flex justify-between text-xs"><Label className="text-xs">{label}</Label>
        <span className="text-slate-500">{c[key] != null ? `${c[key]}px` : t("cards.default", "по умолчанию")}</span></div>
      <input type="range" min={min} max={max} value={c[key] ?? Math.round((min + max) / 2)} data-testid={`input-style-${key}`}
        onChange={e => setC({ [key]: Number(e.target.value) })} className="w-full accent-blue-600" />
    </div>
  );
  return (
    <fieldset disabled={readOnly} className="space-y-4">
      {scope}
      <div className="space-y-1.5">
        <Label>{t("cards.style", "Стиль")}</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {styles.map(s => (
            <button key={s.key} type="button" data-testid={`button-style-${s.key}`} onClick={() => onChange(l => ({ ...l, style: s.key }))}
              className={cn("rounded-md border px-2 py-1.5 text-xs font-medium", layout.style === s.key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:border-slate-300")}>{s.label}</button>
          ))}
        </div>
        <p className="text-xs text-slate-500">{t("cards.styleHint", "Без изменений параметров «Свой» выглядит как стандартная форма ERP.")}</p>
      </div>
      {layout.style === "custom" && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          {color("background", t("cards.styleBg", "Фон карточки"))}
          {color("sectionBackground", t("cards.styleSectionBg", "Фон разделов"))}
          {color("accent", t("cards.styleAccent", "Акцент заголовков"))}
          {range("spacing", t("cards.styleSpacing", "Отступы"), 4, 32)}
          {range("radius", t("cards.styleRadius", "Скругление"), 0, 24)}
          {range("fontSize", t("cards.styleFont", "Размер шрифта"), 12, 20)}
          <div className="flex items-center justify-between"><Label className="text-xs">{t("cards.styleBorder", "Рамка разделов")}</Label><Switch checked={!!c.border} onCheckedChange={v => setC({ border: v })} /></div>
          <div className="flex items-center justify-between"><Label className="text-xs">{t("cards.styleShadow", "Тень разделов")}</Label><Switch checked={!!c.shadow} onCheckedChange={v => setC({ shadow: v })} /></div>
          <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => onChange(l => ({ ...l, customStyle: {} }))}>{t("cards.resetCustom", "Сбросить к стандарту")}</Button>
        </div>
      )}
    </fieldset>
  );
}

function BlockInspector({ block, readOnly, fields, relations, entityId, onPatch, onRemove }: {
  block: CardBlock; readOnly: boolean; fields: Field[]; relations: { id: number; sourceEntityId: number; targetEntityId: number }[]; entityId: number;
  onPatch: (p: Partial<CardBlock>) => void; onRemove: () => void;
}) {
  const t = useT();
  const ml = useML();
  const field = block.fieldKey ? fields.find(f => f.fieldKey === block.fieldKey) : undefined;
  const relation = field?.relationConfigJson?.relationId != null ? relations.find(r => r.id === field.relationConfigJson?.relationId) : undefined;
  const relatedEntityId = relation ? (relation.sourceEntityId === entityId ? relation.targetEntityId : relation.sourceEntityId) : 0;
  const { data: relFields = [] } = useListEntityFields(relatedEntityId, { query: { enabled: block.kind === "relatedTable" && relatedEntityId > 0, queryKey: getListEntityFieldsQueryKey(relatedEntityId) } });
  const bindable = fields.filter(f => f.isActive && (block.kind === "relatedTable" ? f.fieldType === "relation" : true));
  const modeLabel = (m: CardMode) => m === "view" ? t("cards.modeView", "Просмотр") : m === "create" ? t("cards.modeCreate", "Создание") : t("cards.modeEdit", "Изменение");
  return (
    <fieldset disabled={readOnly} className="space-y-4" data-testid="block-inspector">
      {(block.kind === "field" || block.kind === "relatedTable") && (
        <div className="space-y-1.5">
          <Label>{block.kind === "relatedTable" ? t("cards.relationField", "Поле связи") : t("cards.field", "Поле")}</Label>
          <Select value={block.fieldKey ?? "__none__"} onValueChange={v => onPatch({ fieldKey: v === "__none__" ? null : v, columns: [] })}>
            <SelectTrigger data-testid="select-block-field"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t("cards.unbound", "Не привязано (пустая ячейка)")}</SelectItem>
              {bindable.map(f => <SelectItem key={f.id} value={f.fieldKey}>{ml(f.nameJson) || f.fieldKey}</SelectItem>)}
            </SelectContent>
          </Select>
          {block.kind === "field" && field?.fieldType === "relation" && (
            <Button size="sm" variant="outline" className="w-full" data-testid="button-as-table" onClick={() => onPatch({ kind: "relatedTable", span: 3 })}>
              <Table2 className="me-1.5 h-3.5 w-3.5" />{t("cards.showAsTable", "Показывать как таблицу")}
            </Button>
          )}
        </div>
      )}
      {block.kind === "text" ? (
        <MultilingualInput label={t("cards.text", "Текст")} multiline value={block.text ?? {}} onChange={v => onPatch({ text: v })} />
      ) : (
        <MultilingualInput label={block.kind === "divider" ? t("cards.dividerLabel", "Подпись разделителя (необязательно)") : t("cards.labelOverride", "Своя подпись (необязательно)")}
          value={block.label ?? {}} onChange={v => onPatch({ label: v })} />
      )}
      <div className="space-y-1.5">
        <Label>{t("cards.span", "Ширина")}</Label>
        <div className="flex gap-1">
          {[1, 2, 3].map(n => (
            <button key={n} type="button" data-testid={`button-span-${n}`} onClick={() => onPatch({ span: n })}
              className={cn("flex-1 rounded border py-1 text-xs", block.span === n ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600")}>{n}</button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>{t("cards.modes", "Показывать в режимах")}</Label>
        <div className="flex flex-wrap gap-3">
          {CARD_MODES.map(m => (
            <label key={m} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" data-testid={`checkbox-mode-${m}`} checked={block.modes.includes(m)}
                disabled={readOnly || (block.modes.length === 1 && block.modes.includes(m))}
                onChange={e => onPatch({ modes: e.target.checked ? CARD_MODES.filter(x => x === m || block.modes.includes(x)) : block.modes.filter(x => x !== m) })} />
              {modeLabel(m)}
            </label>
          ))}
        </div>
      </div>
      {block.kind === "relatedTable" && block.fieldKey && (
        <div className="space-y-1.5">
          <Label>{t("cards.tableColumns", "Столбцы таблицы")}</Label>
          {relatedEntityId === 0 ? <p className="text-xs text-slate-400">{t("cards.relationUnknown", "Связь поля не найдена")}</p> : (
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2" data-testid="list-table-columns">
              {relFields.filter(f => f.isActive).sort((a, b) => a.sortOrder - b.sortOrder).map(f => {
                const idx = block.columns.indexOf(f.fieldKey);
                return (
                  <label key={f.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" data-testid={`checkbox-column-${f.fieldKey}`} checked={idx >= 0}
                      onChange={e => onPatch({ columns: e.target.checked ? [...block.columns, f.fieldKey].slice(0, 30) : block.columns.filter(c => c !== f.fieldKey) })} />
                    <span className="min-w-0 flex-1 truncate">{ml(f.nameJson) || f.fieldKey}</span>
                    {idx >= 0 && <span className="text-[10px] text-slate-400">{idx + 1}</span>}
                  </label>
                );
              })}
            </div>
          )}
          <p className="text-xs text-slate-500">{t("cards.tableHint", "В карточке над таблицей будет кнопка добавления и привязки записей. Новые связанные записи создаются после сохранения основной записи.")}</p>
        </div>
      )}
      <div className="flex gap-1.5 border-t border-slate-100 pt-3">
        <Button size="sm" variant="outline" className="ms-auto text-red-600" data-testid="button-remove-block" onClick={onRemove}>
          <Trash2 className="me-1 h-3.5 w-3.5" />{t("cards.removeBlock", "Убрать из карточки")}
        </Button>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
export default function CardTemplatesPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : NaN;
  return Number.isFinite(id) ? <TemplateEditor id={id} /> : <TemplateList />;
}
