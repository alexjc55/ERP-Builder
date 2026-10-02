import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { collaborationTooltipPosition } from "@/lib/collaborationTooltipPosition";

/**
 * Mounted only on cells with presence/conflict. Observers and the floating
 * portal exist only while hovered/focused, never on thousands of idle cells.
 */
export function CellCollabTooltip({
  anchorRef, id, isConflict, editorNames, editorColor, conflictLabel, editingLabel,
}: {
  anchorRef: RefObject<HTMLDivElement | null>;
  id: string;
  isConflict: boolean;
  editorNames: string;
  editorColor?: string;
  conflictLabel: string;
  editingLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    let hovered = anchor.matches(":hover");
    let focused = anchor.contains(document.activeElement);
    const update = () => setOpen(hovered || focused);
    const enter = () => { hovered = true; update(); };
    const leave = () => { hovered = false; update(); };
    const focus = () => { focused = true; update(); };
    const blur = (event: FocusEvent) => {
      focused = event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget);
      update();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    anchor.addEventListener("pointerenter", enter);
    anchor.addEventListener("pointerleave", leave);
    anchor.addEventListener("focusin", focus);
    anchor.addEventListener("focusout", blur);
    anchor.addEventListener("keydown", key);
    update();
    return () => {
      anchor.removeEventListener("pointerenter", enter);
      anchor.removeEventListener("pointerleave", leave);
      anchor.removeEventListener("focusin", focus);
      anchor.removeEventListener("focusout", blur);
      anchor.removeEventListener("keydown", key);
    };
  }, [anchorRef]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;
    const position = () => {
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      tooltip.style.maxWidth = `${Math.max(0, width - 16)}px`;
      tooltip.style.maxHeight = `${Math.max(0, height - 16)}px`;
      const coords = collaborationTooltipPosition(
        anchor.getBoundingClientRect(), tooltip.getBoundingClientRect(),
        { width, height, left: viewport?.offsetLeft, top: viewport?.offsetTop },
      );
      tooltip.style.left = `${coords.left}px`;
      tooltip.style.top = `${coords.top}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(anchor);
    observer.observe(tooltip);
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
    };
  }, [open, anchorRef, editorNames, conflictLabel, editingLabel, isConflict]);

  const content = (
    <>
      {isConflict && <div data-testid="cell-conflict" className="text-amber-600 font-bold mb-1">{conflictLabel}</div>}
      {editorNames && (
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 shrink-0 rounded-full" style={{ backgroundColor: editorColor }} />
          <span><span className="font-bold">{editorNames}</span> {editingLabel}</span>
        </div>
      )}
    </>
  );
  // Keep the accessible description available before keyboard focus. Only
  // the visible tooltip is portaled; neither branch contains the cell editor.
  if (!open) return <span id={id} role="tooltip" className="sr-only">{content}</span>;
  return createPortal(
    <div
      ref={tooltipRef}
      id={id}
      role="tooltip"
      dir={anchorRef.current ? getComputedStyle(anchorRef.current).direction : undefined}
      data-testid="cell-collab-popover"
      className="fixed z-[100] pointer-events-none w-max max-w-80 overflow-hidden break-words rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-950 shadow-md"
    >{content}</div>,
    document.body,
  );
}