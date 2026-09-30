import type { RecordQuery } from "@workspace/api-client-react";

/** Accordion selection changes the visible rows, not the filtered group universe. */
export function groupUniverseKey(query: RecordQuery): string {
  // A group click also resets row pagination to page one.
  const { groupValue, withRowGroups, page, ...universe } = query;
  return JSON.stringify(universe);
}

export function isAccordionSelectionChange(
  previous: { scope: string; universe: string; permission: string; query: string; selection: string } | null,
  next: { scope: string; universe: string; permission: string; query: string; selection: string },
): boolean {
  return previous !== null &&
    previous.scope === next.scope &&
    previous.permission === next.permission &&
    previous.universe === next.universe &&
    previous.selection !== next.selection &&
    previous.query !== next.query;
}