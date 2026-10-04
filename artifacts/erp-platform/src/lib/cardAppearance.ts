import type { CSSProperties } from "react";
import { cardStyleVars, type CardLayout } from "./cardLayout";

/** Shared visual rules for the editable canvas and the record form. */
export function cardAppearance(layout: CardLayout): Record<"root" | "section" | "heading" | "grid" | "sections", CSSProperties> {
  const custom = layout.style === "custom" ? layout.customStyle : {};
  const compact = layout.style === "compact";
  return {
    root: {
      ...cardStyleVars(layout),
      background: custom.background,
      fontSize: custom.fontSize != null ? `${custom.fontSize}px` : undefined,
      padding: custom.background ? `${custom.spacing ?? 16}px` : undefined,
      borderRadius: custom.background ? `${custom.radius ?? 8}px` : undefined,
    },
    section: layout.style === "sectioned" ? {
      border: "1px solid rgb(226 232 240)", borderRadius: 8,
      background: "rgb(248 250 252 / 0.6)", padding: 16,
    } : layout.style === "custom" ? {
      background: custom.sectionBackground,
      borderRadius: custom.radius ?? 8,
      border: custom.border ? "1px solid rgb(226 232 240)" : undefined,
      boxShadow: custom.shadow ? "0 1px 3px rgb(15 23 42 / 0.08), 0 1px 2px rgb(15 23 42 / 0.04)" : undefined,
      padding: custom.sectionBackground || custom.border || custom.shadow ? custom.spacing ?? 16 : undefined,
    } : {},
    heading: {
      color: custom.accent ?? custom.textColor,
      ...(compact ? { fontSize: 12, textTransform: "uppercase", letterSpacing: "0.025em" } : {}),
    },
    grid: { columnGap: custom.spacing ?? (compact ? 12 : 16), rowGap: custom.spacing ?? (compact ? 8 : 16) },
    sections: { display: "flex", flexDirection: "column", gap: custom.spacing ?? (compact ? 12 : 20) },
  };
}