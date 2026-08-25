import { createElement, type ReactNode } from "react";

export type DisplayAffixConfig = {
  displayAffix?: string | null;
  displayAffixPosition?: "before" | "after" | null;
};

export function readDisplayAffixConfig(config: unknown): {
  affix: string;
  position: "before" | "after";
} | null {
  if (!config || typeof config !== "object") return null;
  const candidate = config as DisplayAffixConfig;
  const affix = typeof candidate.displayAffix === "string" ? candidate.displayAffix.trim() : "";
  if (!affix) return null;
  return {
    affix,
    position: candidate.displayAffixPosition === "before" ? "before" : "after",
  };
}

/**
 * Adds a display-only plain-text affix to content that has already been
 * numerically formatted. The flex container deliberately inherits direction:
 * semantic child order therefore mirrors visually in RTL, while the numeric
 * token itself remains isolated LTR.
 */
export function AffixedNumericValue({
  children,
  config,
}: {
  children: ReactNode;
  config?: unknown;
}) {
  const display = readDisplayAffixConfig(config);
  const number = createElement("span", { dir: "ltr", "data-affix-part": "number" }, children);
  if (!display) return number;

  const affix = createElement("span", { "data-affix-part": "affix" }, display.affix);
  const parts = display.position === "before" ? [affix, number] : [number, affix];
  return createElement(
    "span",
    {
      className: "inline-flex items-baseline",
      style: { gap: "0.25em" },
      "data-affix-position": display.position,
    },
    ...parts,
  );
}