import { parseCardLayout, type CardLayout } from "./cardLayout";

export function captureCardAppearance(layout: CardLayout) {
  return {
    style: layout.style, presentation: layout.presentation ?? "modal",
    customStyle: structuredClone(layout.customStyle),
  };
}
export function applyCardAppearance(layout: CardLayout, appearance: unknown): CardLayout {
  if (!appearance || typeof appearance !== "object") throw new Error("Invalid appearance");
  const parsed = parseCardLayout({ ...appearance, version: 1, tabs: [{ id: "appearance", title: {}, sections: [] }] });
  if (!parsed) throw new Error("Invalid appearance");
  return { ...layout, ...captureCardAppearance(parsed) };
}
