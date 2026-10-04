import { useEffect, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Loader2, Maximize2, Minimize2, X } from "lucide-react";
import { Dialog, DialogOverlay, DialogPortal } from "@/components/ui/dialog";
import { useLang, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { togglePresentation, type CardPresentation } from "@/lib/cardLayout";

/** Desktop geometry per presentation. Below `sm` every card is fullscreen.
 * Height is FIXED (not max-height) so switching tabs never resizes the window. */
export function presentationClasses(p: CardPresentation, rtl: boolean, wide: boolean): string {
  const mobile = "inset-0 h-[100dvh] w-screen max-w-none rounded-none border-0";
  if (p === "fullscreen") return cn(mobile, "sm:inset-0 sm:h-[100dvh] sm:w-screen");
  if (p === "side") {
    return cn(mobile, "sm:inset-y-0 sm:h-[100dvh] sm:w-[min(60rem,94vw)] sm:border-y-0",
      rtl ? "sm:left-0 sm:right-auto sm:border-e" : "sm:right-0 sm:left-auto sm:border-s");
  }
  return cn(mobile, "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:h-[85dvh] sm:rounded-lg sm:border",
    wide ? "sm:w-[min(56rem,calc(100vw-2rem))]" : "sm:w-[min(36rem,calc(100vw-2rem))]");
}

/**
 * One stable dialog shell for the card preview and every real custom-card form.
 * Header, footer and tab bar stay visible; only the body scrolls (stable gutter).
 * Expand/restore only changes classes on the same mounted tree, so typed values
 * and the active tab survive. `presentation = null` means no custom card is
 * active: the legacy centered form look is kept (same tree, legacy classes).
 * Outside clicks never close (same policy as the shared DialogContent).
 */
export function CardDialogShell({ open, onOpenChange, presentation, wide, header, footer, children, testId, bodyTestId, bodyClassName, pending = false }: {
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  presentation: CardPresentation | null;
  wide?: boolean;
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
  bodyTestId?: string;
  bodyClassName?: string;
}) {
  const t = useT();
  const { lang } = useLang();
  const rtl = lang === "he";
  // User expand/restore override; null = the template default. Reset per opening.
  const [override, setOverride] = useState<CardPresentation | null>(null);
  useEffect(() => { if (!open) setOverride(null); }, [open]);
  const current: CardPresentation | null = presentation == null ? null : (override ?? presentation);
  const custom = current != null;
  const expanded = current === "fullscreen";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay className={cn(custom && current === "side" && "bg-slate-900/40")} />
        {pending && <div role="status" data-testid="card-opening" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center text-white">
          <Loader2 aria-hidden className="h-7 w-7 animate-spin" /><span className="sr-only">{t("common.loading", "Загрузка...")}</span>
        </div>}
        <DialogPrimitive.Content
          style={pending ? { opacity: 0, pointerEvents: "none" } : undefined}
          aria-busy={pending}
          inert={pending || undefined}
          dir={rtl ? "rtl" : "ltr"}
          data-testid={testId}
          data-card-presentation={custom ? current : "legacy"}
          data-card-default={presentation ?? "legacy"}
          onPointerDownOutside={e => e.preventDefault()}
          onInteractOutside={e => e.preventDefault()}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-background shadow-lg",
            custom
              ? presentationClasses(current, rtl, !!wide)
              : cn("left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-h-[85vh] w-full border sm:rounded-lg", wide ? "max-w-4xl" : "max-w-lg"),
          )}
        >
          <div data-testid="card-shell-header" className={cn("relative shrink-0 pe-20 text-start", custom ? "border-b border-slate-200 px-4 pb-3 pt-4 sm:px-6" : "px-6 pt-6")}>
            {header}
            <div className="absolute end-3 top-3 flex items-center gap-1">
              {custom && (
                <button type="button" data-testid="button-card-expand" aria-pressed={expanded}
                  aria-label={expanded ? t("cards.restoreWindow", "Свернуть окно") : t("cards.expandWindow", "Развернуть на весь экран")}
                  title={expanded ? t("cards.restoreWindow", "Свернуть окно") : t("cards.expandWindow", "Развернуть на весь экран")}
                  onClick={() => { if (presentation && current) setOverride(togglePresentation(current, presentation)); }}
                  className="hidden rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:inline-flex">
                  {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
              )}
              <DialogPrimitive.Close data-testid="button-card-close" aria-label={t("common.close", "Закрыть")}
                className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <X className="h-4 w-4" />
              </DialogPrimitive.Close>
            </div>
          </div>
          <div data-testid={bodyTestId ?? "card-shell-body"} style={{ scrollbarGutter: "stable" }}
            className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", custom ? "px-4 py-4 sm:px-6" : "px-6 py-4", bodyClassName)}>
            {children}
          </div>
          {footer && (
            <div data-testid="card-shell-footer" className={cn("flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end", custom ? "border-t border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-6" : "px-6 pb-6 pt-2")}>
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
