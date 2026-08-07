import { useCallback, useMemo } from "react";
import { useListPages, type Page } from "@workspace/api-client-react";
import { useML } from "@/lib/i18n";

/**
 * Shared page-label helper for every dropdown that lists PAGES by name.
 *
 * Pages can be nested (pages.parentPageId), and different branches may contain
 * pages with identical names (e.g. «Бухгалтерия → Производство» vs a root-level
 * «Производство»). A bare name in a picker is then ambiguous, so this hook
 * prefixes the full parent chain: "Бухгалтерия / Производство".
 *
 * Usage: const pageLabel = usePagePathLabel();
 *   pageLabel(page)  — full path label for a Page object
 *   pageLabel(id)    — same by page id (falls back to `#id` if unknown)
 *
 * The parent chain is resolved against the FULL pages list (useListPages is
 * cached by react-query), so it works even when the picker itself renders a
 * filtered subset (e.g. mirror pages only) whose parents are not in the subset.
 */
export function usePagePathLabel(): (page: Page | number) => string {
  const { data: allPages = [] } = useListPages();
  const ml = useML();

  const byId = useMemo(() => {
    const m = new Map<number, Page>();
    for (const p of allPages as Page[]) m.set(p.id, p);
    return m;
  }, [allPages]);

  return useCallback(
    (page: Page | number): string => {
      const target = typeof page === "number" ? byId.get(page) : page;
      if (!target) return `#${page}`;
      const parts: string[] = [];
      let cur: Page | undefined = target;
      const seen = new Set<number>(); // cycle guard
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        parts.unshift(ml(cur.nameJson) || `#${cur.id}`);
        cur = cur.parentPageId != null ? byId.get(cur.parentPageId) : undefined;
      }
      return parts.join(" / ");
    },
    [byId, ml],
  );
}
