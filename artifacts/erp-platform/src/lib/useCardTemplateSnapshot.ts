import { useEffect, useRef, useState } from "react";
import { resolveCardTemplate } from "@workspace/api-client-react";
import { parseCardLayout, type CardLayout, type CardMode } from "./cardLayout";

export type CardSnapshot =
  | { status: "idle" | "loading"; layout: null }
  | { status: "ready"; layout: CardLayout | null }
  | { status: "error"; layout: null; message: string };

/**
 * Resolves the active card template ONCE per form opening and freezes it.
 * A publication that happens while the form is open never swaps the layout
 * under the user; the next opening picks up the new template. Any failure
 * failure is surfaced as an explicit error with retry; only an explicit
 * `template: null` means "use the standard form" (fail fast, no silent fallback).
 */
export function useCardTemplateSnapshot(opts: {
  open: boolean; entityId: number | null | undefined; pageId?: number | null; mode: CardMode;
}): CardSnapshot & { retry: () => void } {
  const { open, entityId, pageId, mode } = opts;
  const [snap, setSnap] = useState<CardSnapshot>({ status: "idle", layout: null });
  const keyRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open || entityId == null) {
      keyRef.current = null;
      setSnap({ status: "idle", layout: null });
      return;
    }
    const key = `${entityId}:${pageId ?? ""}:${mode}`;
    if (keyRef.current === key) return;
    keyRef.current = key;
    let cancelled = false;
    setSnap({ status: "loading", layout: null });
    resolveCardTemplate({ entityId, ...(pageId != null ? { pageId } : {}), mode })
      .then(res => {
        if (cancelled) return;
        if (res && typeof res === "object" && !Array.isArray(res) && res.template === null) {
          setSnap({ status: "ready", layout: null });
          return;
        }
        if (!res || typeof res !== "object" || Array.isArray(res) || !res.template) {
          setSnap({ status: "error", layout: null, message: "Unexpected card template response" });
          return;
        }
        const layout = parseCardLayout(res.template.layout);
        if (!layout) setSnap({ status: "error", layout: null, message: "Invalid card template layout" });
        else setSnap({ status: "ready", layout });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        keyRef.current = null;
        setSnap({ status: "error", layout: null, message: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
      // Allow a retry if this effect is torn down before the request settled.
      if (keyRef.current === key) keyRef.current = null;
    };
  }, [open, entityId, pageId, mode, attempt]);
  return { ...snap, retry: () => { keyRef.current = null; setAttempt(a => a + 1); } };
}
