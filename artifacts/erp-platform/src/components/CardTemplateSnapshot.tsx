import type { ReactNode } from "react";
import { useCardTemplateSnapshot } from "@/lib/useCardTemplateSnapshot";
import type { CardMode } from "@/lib/cardLayout";

/** Keep async template state inside the dialog, not in the large records page.
 * Resolving a template must not re-render every table row and filter. */
export function CardTemplateSnapshot({ children, ...scope }: {
  open: boolean;
  entityId: number | null | undefined;
  pageId?: number | null;
  mode: CardMode;
  children: (snapshot: ReturnType<typeof useCardTemplateSnapshot>) => ReactNode;
}) {
  const snapshot = useCardTemplateSnapshot(scope);
  return <>{children(snapshot)}</>;
}