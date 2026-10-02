/** Viewport-relative placement; independent of table overflow and LTR/RTL. */
export function collaborationTooltipPosition(
  anchor: { left: number; right: number; top: number; bottom: number },
  tooltip: { width: number; height: number },
  viewport: { width: number; height: number; left?: number; top?: number },
) {
  const margin = 8;
  const leftEdge = (viewport.left ?? 0) + margin;
  const topEdge = (viewport.top ?? 0) + margin;
  const rightEdge = (viewport.left ?? 0) + viewport.width - margin;
  const bottomEdge = (viewport.top ?? 0) + viewport.height - margin;
  const width = Math.min(tooltip.width, Math.max(0, viewport.width - margin * 2));
  const height = Math.min(tooltip.height, Math.max(0, viewport.height - margin * 2));
  const above = anchor.top - margin - height;
  const below = anchor.bottom + margin;
  const preferredTop = above >= topEdge || anchor.top - topEdge > bottomEdge - anchor.bottom
    ? above : below;
  return {
    left: Math.max(leftEdge, Math.min((anchor.left + anchor.right - width) / 2, rightEdge - width)),
    top: Math.max(topEdge, Math.min(preferredTop, bottomEdge - height)),
  };
}