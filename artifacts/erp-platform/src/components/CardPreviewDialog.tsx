import { useState } from "react";
import { useListEntityFields, getListEntityFieldsQueryKey, type Field } from "@workspace/api-client-react";
import { Eye, FlaskConical, Paperclip, UserRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CardLayoutView, CardDividerBlock, CardTextBlock } from "@/components/CardLayoutView";
import { useLang, useML, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { CARD_MODES, type CardBlock, type CardLayout, type CardMode } from "@/lib/cardLayout";
import { demoValue, demoValueText, type DemoValue } from "@/lib/cardDemoData";
import { normalizeSelectOptions } from "@/lib/selectOptions";

type Rel = { id: number; sourceEntityId: number; targetEntityId: number };

/**
 * Isolated card preview: renders the CURRENT unsaved layout with synthetic
 * values derived from field metadata. No records are fetched, nothing is
 * written, and no real form hooks are mounted.
 */
export function CardPreviewDialog({ open, onOpenChange, layout, fields, relations, entityId, entityName }: {
  open: boolean; onOpenChange: (o: boolean) => void; layout: CardLayout; fields: Field[]; relations: Rel[]; entityId: number; entityName: string;
}) {
  const t = useT();
  const { lang } = useLang();
  const [mode, setMode] = useState<CardMode>("view");
  const byKey = new Map(fields.map(f => [f.fieldKey, f]));
  const modeLabel = (m: CardMode) => m === "view" ? t("cards.modeView", "Просмотр") : m === "create" ? t("cards.modeCreate", "Создание") : t("cards.modeEdit", "Изменение");
  const relatedEntityOf = (f: Field | undefined) => {
    const rid = f?.relationConfigJson?.relationId;
    const r = rid != null ? relations.find(x => x.id === rid) : undefined;
    return r ? (r.sourceEntityId === entityId ? r.targetEntityId : r.sourceEntityId) : 0;
  };
  const renderBlock = (b: CardBlock) => {
    if (b.kind === "text") return <CardTextBlock block={b} />;
    if (b.kind === "divider") return <CardDividerBlock block={b} />;
    const f = b.fieldKey ? byKey.get(b.fieldKey) : undefined;
    if (b.kind === "relatedTable") return <DemoRelatedTable block={b} field={f} relatedEntityId={relatedEntityOf(f)} mode={mode} />;
    return <DemoField block={b} field={f} mode={mode} />;
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir={lang === "he" ? "rtl" : "ltr"} data-testid="dialog-card-preview"
        className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:w-full">
        <DialogHeader className="space-y-2 border-b border-slate-200 px-4 pb-3 pt-4 text-start sm:px-6">
          <DialogTitle className="flex items-center gap-2 pe-8 text-base"><Eye className="h-4 w-4 text-blue-600" />{t("cards.previewTitle", "Предпросмотр карточки")}<span className="truncate font-normal text-slate-500">· {entityName}</span></DialogTitle>
          <DialogDescription className="text-xs">{t("cards.previewDesc", "Показан текущий макет, включая несохранённые изменения. Ничего не сохраняется.")}</DialogDescription>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label={t("cards.previewMode", "Режим предпросмотра")}>
              {CARD_MODES.map(m => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} data-testid={`button-preview-dialog-mode-${m}`} onClick={() => setMode(m)}
                  className={cn("rounded px-2.5 py-1 text-xs font-medium", mode === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}>{modeLabel(m)}</button>
              ))}
            </div>
            <span data-testid="badge-demo-data" className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              <FlaskConical className="h-3 w-3" />{t("cards.demoData", "Демонстрационные данные")}
            </span>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-3 py-4 sm:px-6" data-testid="preview-scroll">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            {/* key: switching mode remounts so tab state starts at the first visible tab */}
            <CardLayoutView key={mode} layout={layout} mode={mode} renderBlock={renderBlock} />
            {!layout.tabs.some(tb => tb.sections.some(s => s.blocks.some(b => b.modes.includes(mode)))) && (
              <p className="py-8 text-center text-sm text-slate-400" data-testid="text-preview-empty">{t("cards.previewEmpty", "В этом режиме в карточке нет блоков")}</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ValueView({ v, field }: { v: DemoValue; field?: Field }) {
  const t = useT();
  const ml = useML();
  switch (v.kind) {
    case "boolean": return <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded border text-[10px]", v.value ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300")} aria-label={v.value ? t("common.yes", "Да") : t("common.no", "Нет")}>{v.value ? "✓" : ""}</span>;
    case "options": {
      const opts = normalizeSelectOptions(field?.optionsJson);
      return <span className="flex flex-wrap gap-1">{v.values.map(x => <span key={x} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{ml(opts.find(o => o.value === x)?.labelJson) || x}</span>)}</span>;
    }
    case "status": return <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">{t("cards.demoStatus", "В работе")}</span>;
    case "relation": return <span className="flex flex-wrap gap-1">{v.values.map(x => <span key={x} className="rounded border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">{x}</span>)}</span>;
    case "link": return <span className="text-blue-700 underline-offset-2" dir="ltr">{v.value}</span>;
    case "file": return <span className="inline-flex items-center gap-1 text-slate-700"><Paperclip className="h-3.5 w-3.5" />{v.value}</span>;
    case "user": return <span className="inline-flex items-center gap-1 text-slate-700"><UserRound className="h-3.5 w-3.5" />{v.value}</span>;
    case "multiline": return <span className="whitespace-pre-wrap">{v.value}</span>;
    case "number": case "formula": case "date": case "datetime": return <span className="tabular-nums" dir="ltr">{demoValueText(v)}</span>;
    default: return <span>{v.value}</span>;
  }
}

function DemoField({ block, field, mode }: { block: CardBlock; field?: Field; mode: CardMode }) {
  const t = useT();
  const ml = useML();
  if (!field) {
    return <div aria-hidden className="min-h-8" data-testid={`preview-empty-${block.id}`} data-blank="true" />;
  }
  const label = ml(block.label) || ml(field.nameJson) || field.fieldKey;
  const v = demoValue(field, field.id ?? 0);
  const readonlyType = field.fieldType === "function" || field.fieldType === "created_at" || field.fieldType === "lookup";
  return (
    <div className="space-y-1.5" data-testid={`preview-field-${field.fieldKey}`} data-field-type={field.fieldType}>
      {/* Card text color applies to labels only, never to values inside inputs. */}
      <div className="text-sm font-medium text-slate-700" style={{ color: "var(--card-text)" }}>
        {label}{field.isRequired && mode !== "view" && <span className="ms-0.5 text-red-500">*</span>}
      </div>
      {mode === "view" || readonlyType ? (
        <div className="min-h-9 rounded-md border border-transparent bg-slate-50 px-3 py-2 text-sm text-slate-800"><ValueView v={v} field={field} /></div>
      ) : mode === "create" && v.kind !== "boolean" ? (
        <div aria-hidden className="flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-400">{t("cards.demoEmptyInput", "Пустое поле")}</div>
      ) : (
        <div aria-hidden className="flex min-h-9 items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800">
          <ValueView v={mode === "create" ? { kind: "boolean", value: false } : v} field={field} />
        </div>
      )}
    </div>
  );
}

function DemoRelatedTable(props: { block: CardBlock; field?: Field; relatedEntityId: number; mode: CardMode }) {
  // Unbound table slot: an intentional, invisible layout spacer.
  if (!props.field) return <div aria-hidden className="min-h-8" data-testid={`preview-empty-${props.block.id}`} data-blank="true" />;
  return <BoundDemoRelatedTable {...props} />;
}

function BoundDemoRelatedTable({ block, field, relatedEntityId, mode }: { block: CardBlock; field?: Field; relatedEntityId: number; mode: CardMode }) {
  const t = useT();
  const ml = useML();
  // Metadata only: related field definitions; no related records are read.
  const { data: relFields = [], isLoading } = useListEntityFields(relatedEntityId, { query: { enabled: relatedEntityId > 0, queryKey: getListEntityFieldsQueryKey(relatedEntityId) } });
  const title = ml(block.label) || (field ? ml(field.nameJson) || field.fieldKey : t("cards.kindTable", "Таблица"));
  const cols = block.columns.map(k => relFields.find(f => f.fieldKey === k)).filter((f): f is Field => !!f);
  const shown = cols.length ? cols : relFields.filter(f => f.isActive).slice(0, 3);
  const rows = mode === "create" ? [] : [0, 1];
  return (
    <div className="space-y-2" data-testid={`preview-related-${block.id}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-slate-700" style={{ color: "var(--card-text)" }}>{title}</div>
        {mode !== "view" && <span aria-hidden className="rounded border border-slate-200 px-2 py-0.5 text-xs text-slate-400">{t("cards.relatedAddLink", "Добавить / привязать")}</span>}
      </div>
      {isLoading ? <Skeleton className="h-20 w-full" /> : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>{shown.length ? shown.map(c => <th key={c.fieldKey} className="px-3 py-2 text-start font-medium">{ml(c.nameJson) || c.fieldKey}</th>) : <th className="px-3 py-2 text-start font-medium">#</th>}</tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r} className="border-t border-slate-100" data-testid={`preview-related-row-${block.id}-${r}`}>
                  {shown.length ? shown.map(c => <td key={c.fieldKey} className="px-3 py-2 text-slate-700"><ValueView v={demoValue(c, r + 1)} field={c} /></td>) : <td className="px-3 py-2 text-slate-700">{t("cards.demoRecord", "Демо-запись")} {r + 1}</td>}
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={Math.max(1, shown.length)} className="px-3 py-4 text-center text-xs text-slate-400">{t("cards.previewNoRelated", "Связанные записи появятся после сохранения")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
