import type { CSSProperties, DragEvent, ReactNode } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { CardRow, RowColumns } from "@/lib/cardLayout";
import { SECTION_GRID, BLOCK_SPAN } from "@/components/CardLayoutView";

/**
 * One explicit row in the card builder canvas. The editor-only toolbar sits in a
 * slim gutter strip above the row; the row grid itself has no padding or border
 * so the canvas matches runtime spacing.
 */
export function CardTemplateRow({
  row, sectionIndex, rowIndex, rowCount, readOnly, gridStyle, children, dropActive,
  onColumns, onMove, onDelete, onDragOverEnd, onDragLeave, onDropEnd,
}: {
  row: CardRow; sectionIndex: number; rowIndex: number; rowCount: number; readOnly: boolean;
  gridStyle: CSSProperties; children: ReactNode; dropActive: boolean;
  onColumns: (n: RowColumns) => void; onMove: (delta: -1 | 1) => void; onDelete: () => void;
  onDragOverEnd: (e: DragEvent) => void; onDragLeave: () => void; onDropEnd: (e: DragEvent) => void;
}) {
  const t = useT();
  const id = `${sectionIndex}-${rowIndex}`;
  const populated = row.blockIds.length > 0;
  const cannotDelete = populated && rowCount <= 1;
  const deleteLabel = cannotDelete
    ? t("cards.rowDeleteOnly", "Нельзя удалить единственную строку с полями")
    : populated
      ? (rowIndex > 0 ? t("cards.rowDeleteMoveUp", "Удалить строку (поля перейдут в строку выше)") : t("cards.rowDeleteMoveDown", "Удалить строку (поля перейдут в строку ниже)"))
      : t("cards.rowDelete", "Удалить строку");
  return (
    <div className="group/row relative min-w-0" data-testid={`editor-row-${id}`} data-row-id={row.id} data-row-columns={row.columns}>
      {!readOnly && (
        <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
          <span className="me-1 tabular-nums">{t("cards.row", "Строка")} {rowIndex + 1}</span>
          <div className="flex items-center rounded border border-slate-200 bg-white p-px" role="group" aria-label={t("cards.rowColumns", "Колонки строки")}>
            {([1, 2, 3] as RowColumns[]).map(n => (
              <button key={n} type="button" data-testid={`button-row-cols-${id}-${n}`} aria-pressed={row.columns === n}
                title={`${t("cards.rowColumns", "Колонки строки")}: ${n}`} onClick={() => onColumns(n)}
                className={cn("h-5 w-5 rounded-sm text-[11px] font-semibold", row.columns === n ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100")}>{n}</button>
            ))}
          </div>
          <span className="h-px flex-1 bg-slate-200/70" />
          <div className="flex items-center opacity-60 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100">
            <button type="button" data-testid={`button-row-up-${id}`} aria-label={t("cards.rowUp", "Строку выше")} title={t("cards.rowUp", "Строку выше")}
              disabled={rowIndex === 0} onClick={() => onMove(-1)} className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
            <button type="button" data-testid={`button-row-down-${id}`} aria-label={t("cards.rowDown", "Строку ниже")} title={t("cards.rowDown", "Строку ниже")}
              disabled={rowIndex === rowCount - 1} onClick={() => onMove(1)} className="rounded p-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
            <button type="button" data-testid={`button-row-delete-${id}`} aria-label={deleteLabel} title={deleteLabel}
              disabled={cannotDelete} onClick={onDelete} className="rounded p-0.5 text-red-500 hover:bg-red-50 disabled:opacity-30"><Trash2 className="h-3 w-3" /></button>
          </div>
        </div>
      )}
      <div className={cn("grid min-w-0", SECTION_GRID[row.columns])} style={gridStyle}
        onDragOver={onDragOverEnd} onDragLeave={onDragLeave} onDrop={onDropEnd}>
        {children}
        {!readOnly && (
          <div data-testid={`editor-row-drop-${id}`}
            className={cn("flex min-h-[34px] items-center justify-center rounded-md border border-dashed text-[11px] text-slate-400 transition-colors",
              populated ? BLOCK_SPAN[1] : BLOCK_SPAN[row.columns],
              dropActive ? "border-blue-400 bg-blue-50 text-blue-600" : "border-slate-200")}>
            {populated ? "+" : t("cards.rowEmpty", "Пустая строка — перетащите поле сюда")}
          </div>
        )}
      </div>
    </div>
  );
}
