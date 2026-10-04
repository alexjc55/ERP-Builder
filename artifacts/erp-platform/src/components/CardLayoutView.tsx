import type { CSSProperties, ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLang, useML, useT } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { effectiveSpan, mlIsEmpty, type CardBlock, type CardLayout, type CardMode } from "@/lib/cardLayout";
import { cardAppearance } from "@/lib/cardAppearance";
import { RUN_LANGS, dividerRenderProps, effectiveRuns, isWebLink, runStyle, sanitizeLink, textRenderProps, type RunLang, type TextRun } from "@/lib/cardBlockStyle";

export const SECTION_GRID: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 md:grid-cols-2",
  3: "grid-cols-1 md:grid-cols-3",
};
export const BLOCK_SPAN: Record<number, string> = { 1: "", 2: "md:col-span-2", 3: "md:col-span-3" };

/**
 * Runtime renderer of a card layout. Field controls are NOT implemented here —
 * the caller (the shared RecordFormBody) renders every field block through its
 * own single field renderer, so permissions, locks and dependencies stay shared.
 */
export function CardLayoutView({ layout, mode, renderBlock }: {
  layout: CardLayout;
  mode: CardMode;
  renderBlock: (block: CardBlock) => ReactNode;
}) {
  const ml = useML();
  const { lang } = useLang();
  const style = layout.style;
  const custom = style === "custom" ? layout.customStyle : {};
  const visibleBlocks = (blocks: CardBlock[]) => blocks.filter(b => b.modes.includes(mode));
  const appearance = cardAppearance(layout);
  const gap = style === "compact" ? "gap-x-3 gap-y-2" : "gap-4";

  const sectionNode = (section: CardLayout["tabs"][number]["sections"][number]) => {
    const blocks = visibleBlocks(section.blocks);
    if (blocks.length === 0) return null;
    const cols = Math.min(3, Math.max(1, section.columns));
    const title = ml(section.title);
    return (
      <section
        key={section.id}
        data-testid={`card-section-${section.id}`}
        className={cn(
          "min-w-0",
          style === "sectioned" && "rounded-lg border border-slate-200 bg-slate-50/60 p-4",
          style === "custom" && "card-custom-section",
        )}
        style={appearance.section}
      >
        {title && (
          <h3
            className={cn(
              "mb-3 font-semibold text-slate-700",
              style === "compact" ? "text-xs uppercase tracking-wide text-slate-500 mb-2" : "text-sm",
              style === "sectioned" && "border-b border-slate-200 pb-2",
            )}
            style={appearance.heading}
          >
            {title}
          </h3>
        )}
        {section.rows ? (
          // Explicit rows: the stack gap equals the in-row row gap, so wrapped
          // and explicit rows are spaced identically. Rows carry no padding/border.
          <div className="flex min-w-0 flex-col" data-testid={`card-rows-${section.id}`} style={{ gap: appearance.grid.rowGap }}>
            {section.rows.map(row => {
              const byId = new Map(blocks.map(b => [b.id, b]));
              const rowBlocks = row.blockIds.map(id => byId.get(id)).filter((b): b is CardBlock => !!b);
              if (rowBlocks.length === 0) return null;
              const rc = Math.min(3, Math.max(1, row.columns));
              return (
                <div key={row.id} data-testid={`card-row-${row.id}`} data-row-columns={rc} className={cn("grid min-w-0", SECTION_GRID[rc], gap)} style={appearance.grid}>
                  {rowBlocks.map(b => (
                    <div key={b.id} data-testid={`card-cell-${b.id}`} data-block-span={effectiveSpan(b.span, rc)} className={cn("min-w-0", !b.fieldKey && (b.kind === "field" || b.kind === "relatedTable") && "min-h-8", BLOCK_SPAN[effectiveSpan(b.span, rc)])}>{renderBlock(b)}</div>
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={cn("grid min-w-0", SECTION_GRID[cols], gap)} style={appearance.grid}>
            {blocks.map(b => (
              <div key={b.id} data-testid={`card-cell-${b.id}`} data-block-span={effectiveSpan(b.span, cols)} className={cn("min-w-0", !b.fieldKey && (b.kind === "field" || b.kind === "relatedTable") && "min-h-8", BLOCK_SPAN[effectiveSpan(b.span, cols)])}>
                {renderBlock(b)}
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  const tabBody = (tab: CardLayout["tabs"][number]) => (
    <div className="min-w-0" style={appearance.sections}>
      {tab.sections.map(sectionNode)}
    </div>
  );

  const tabs = layout.tabs.filter(tab => tab.sections.some(s => visibleBlocks(s.blocks).length > 0));
  const body = tabs.length <= 1 ? (tabs[0] ? tabBody(tabs[0]) : null) : (
    <Tabs defaultValue={tabs[0].id} dir={lang === "he" ? "rtl" : "ltr"} className="min-w-0">
      {/* Sticky inside the card shell scroll body: the tab bar never scrolls away. */}
      <div className="sticky top-0 z-10 -mt-1 mb-3 bg-[var(--card-bg,hsl(var(--background)))] pt-1" data-testid="card-tabs-bar">
      <TabsList className="h-auto flex-wrap justify-start">
        {tabs.map((tab, i) => (
          <TabsTrigger key={tab.id} value={tab.id} data-testid={`card-tab-${tab.id}`}
            style={style === "custom" && custom.accent ? ({ "--tw-ring-color": custom.accent } as CSSProperties) : undefined}>
            {mlIsEmpty(tab.title) ? `${i + 1}` : ml(tab.title)}
          </TabsTrigger>
        ))}
      </TabsList>
      </div>
      {/* forceMount keeps every tab's inputs mounted: switching tabs never drops typed values or open pickers. */}
      {tabs.map(tab => (
        <TabsContent key={tab.id} value={tab.id} forceMount className="mt-0 data-[state=inactive]:hidden">
          {tabBody(tab)}
        </TabsContent>
      ))}
    </Tabs>
  );

  return (
    <div
      data-testid="card-layout"
      data-card-style={style}
      className="min-w-0"
      style={appearance.root}
    >
      {body}
    </div>
  );
}

/** Escaped inline runs (React text nodes only, never HTML). Shared by the
 * editor live preview, runtime card and preview dialog. */
export function TextRunsView({ runs, blockId }: { runs: TextRun[]; blockId: string }) {
  return (
    <>
      {runs.map((r, i) => {
        const st = runStyle(r) as CSSProperties;
        const href = r.link ? sanitizeLink(r.link) : null;
        if (href) {
          return (
            <a key={i} href={href} data-testid={`link-card-text-${blockId}-${i}`} className="underline underline-offset-2" style={{ color: "inherit", ...st }}
              {...(isWebLink(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{r.text}</a>
          );
        }
        return Object.keys(st).length ? <span key={i} data-run={i} style={st}>{r.text}</span> : <span key={i}>{r.text}</span>;
      })}
    </>
  );
}

/** Text block. Blocks with `textRuns` render inline runs; legacy blocks keep
 * the original whole-block formatting byte-for-byte until edited. */
export function CardTextBlock({ block }: { block: CardBlock }) {
  const ml = useML();
  const { lang } = useLang();
  const text = ml(block.text);
  if (!text) return null;
  const r = textRenderProps(block.textStyle);
  if (block.textRuns) {
    const tx = (block.text ?? {}) as Partial<Record<RunLang, string>>;
    const shown: RunLang = tx[lang as RunLang] === text ? (lang as RunLang) : (RUN_LANGS.find(l => tx[l] === text) ?? "ru");
    const runs = effectiveRuns(tx, block.textRuns, shown);
    const base: CSSProperties = { textAlign: (block.textStyle?.align ?? "start") as CSSProperties["textAlign"], color: "var(--card-text, #475569)" };
    return (
      <p data-testid={`card-text-${block.id}`} data-rich="runs" dir={r.dir} className="whitespace-pre-wrap break-words text-sm text-slate-600" style={base}>
        <TextRunsView runs={runs} blockId={block.id} />
      </p>
    );
  }
  return (
    <p data-testid={`card-text-${block.id}`} dir={r.dir} className="whitespace-pre-wrap break-words text-sm text-slate-600" style={r.style as CSSProperties}>
      {r.href ? (
        <a href={r.href} data-testid={`link-card-text-${block.id}`} className="underline-offset-2 hover:underline" style={{ color: "inherit" }}
          {...(r.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{text}</a>
      ) : text}
    </p>
  );
}

/** Divider: legacy line (+ optional label) by default; `space` draws no line. */
export function CardDividerBlock({ block }: { block: CardBlock }) {
  const ml = useML();
  const label = ml(block.label);
  const d = dividerRenderProps(block.dividerStyle);
  const legacy = !block.dividerStyle || (d.kind === "solid" && d.thickness === 1 && !block.dividerStyle.color);
  if (d.kind === "space") {
    return (
      <div data-testid={`card-divider-${block.id}`} data-divider-kind="space" role="separator" aria-orientation="horizontal" data-divider-height={d.height} style={{ minHeight: d.height, height: label ? undefined : d.height }}
        className="flex items-center">
        {label && <span className="text-xs font-medium uppercase tracking-wide text-slate-400" style={{ color: "var(--card-text, #94a3b8)" }}>{label}</span>}
      </div>
    );
  }
  const line: CSSProperties = { borderTopWidth: d.thickness, borderTopStyle: d.kind, borderTopColor: d.color };
  if (legacy) {
    return label ? (
      <div className="flex items-center gap-3 py-1" data-testid={`card-divider-${block.id}`} data-divider-kind="solid">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400" style={{ color: "var(--card-text, #94a3b8)" }}>{label}</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
    ) : <hr className="my-1 border-slate-200" data-testid={`card-divider-${block.id}`} data-divider-kind="solid" />;
  }
  return label ? (
    <div className="flex items-center gap-3 py-1" data-testid={`card-divider-${block.id}`} data-divider-kind={d.kind} role="separator">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400" style={{ color: "var(--card-text, #94a3b8)" }}>{label}</span>
      <span className="flex-1" data-testid={`card-divider-line-${block.id}`} style={line} />
    </div>
  ) : <hr className="my-1" data-testid={`card-divider-${block.id}`} data-divider-kind={d.kind} style={{ border: 0, ...line }} />;
}

/** Gate shown while the card snapshot resolves: skeleton, explicit error with
 * retry, or the form (layout null = standard form, only on template:null). */
export function CardSnapshotGate({ snapshot, children }: {
  snapshot: { status: "idle" | "loading" | "ready" | "error"; layout: CardLayout | null; message?: string; retry: () => void };
  children: (layout: CardLayout | null) => ReactNode;
}) {
  const t = useT();
  if (snapshot.status === "error") {
    return (
      <div role="alert" data-testid="card-resolve-error" className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        <p>{t("cards.resolveError", "Не удалось загрузить карточку записи.")}</p>
        {snapshot.message && <p className="text-xs text-red-500 break-words">{snapshot.message}</p>}
        <button type="button" data-testid="button-card-resolve-retry" onClick={snapshot.retry}
          className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-red-100">
          {t("common.retry", "Повторить")}
        </button>
      </div>
    );
  }
  if (snapshot.status !== "ready") {
    return (
      <div className="space-y-3" data-testid="card-resolve-loading">
        {[0, 1, 2].map(i => (
          <div key={i} className="space-y-1.5"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-9 w-full" /></div>
        ))}
      </div>
    );
  }
  return <>{children(snapshot.layout)}</>;
}
