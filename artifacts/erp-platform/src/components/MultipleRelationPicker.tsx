import { useEffect, useState, type ReactNode } from "react";
import { useGetEntityRelatedCandidates, useGetPageRelatedCandidates, useSetEntityRelatedLink, useSetPageRelatedLink, type PageRelatedCandidate } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { relationDraftIds } from "@/lib/relationSelections";

export function MultipleRelationPicker(props: {
  entityId: number; fieldKey: string; pageId?: number; pageField?: boolean;
  recordId?: number; expectedVersion?: number; ids?: number[];
  members?: PageRelatedCandidate[]; value?: unknown; disabled?: boolean;
  dependent?: boolean; parentValue?: string | null;
  onChange?: (value: string) => void; onChanged?: (version?: number) => void;
  onEditingChange?: (open: boolean) => void;
  renderQuickCreate?: (props: { open: boolean; onOpenChange: (open: boolean) => void; relatedEntityId: number; onCreated: (id: number, label: string | null) => void }) => ReactNode;
}) {
  const { entityId, fieldKey, recordId, pageId, pageField, parentValue, dependent } = props;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [candidates, setCandidates] = useState<PageRelatedCandidate[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createEntityId, setCreateEntityId] = useState<number | null>(null);
  const entityCandidates = useGetEntityRelatedCandidates().mutateAsync;
  const pageCandidates = useGetPageRelatedCandidates().mutateAsync;
  const entityLink = useSetEntityRelatedLink();
  const pageLink = useSetPageRelatedLink();
  const ids = recordId == null ? relationDraftIds(props.value) : props.ids ?? [];
  const gated = dependent && !parentValue;
  const busy = entityLink.isPending || pageLink.isPending;
  const changeOpen = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    props.onEditingChange?.(next);
    if (next) { setSelected(ids); setError(""); setSearch(""); }
  };
  useEffect(() => {
    if (!open || props.disabled || gated) return;
    let cancelled = false;
    setLoading(true);
    setCandidates([]);
    setCreateEntityId(null);
    setError("");
    // Complete permission-filtered snapshot: select-all is never a first-page operation.
    const data = { fieldKey, all: true, ...(dependent ? { parentValue } : {}) };
    const request = pageField && pageId != null
      ? pageCandidates({ pageId, data }) : entityCandidates({ entityId, data });
    request.then(result => { if (!cancelled) {
      setCandidates(result.candidates);
      setCreateEntityId(result.canCreate ? result.relatedEntityId ?? null : null);
    } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить записи"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, entityId, pageId, pageField, fieldKey, dependent, parentValue, gated, props.disabled, entityCandidates, pageCandidates]);
  const save = async () => {
    setError("");
    try {
      if (recordId == null) props.onChange?.(JSON.stringify(selected));
      else {
        const data = { fieldKey, recordId, linkedRecordIds: selected, expectedVersion: props.expectedVersion };
        const result = pageField && pageId != null
          ? await pageLink.mutateAsync({ pageId, data }) : await entityLink.mutateAsync({ entityId, data });
        props.onChanged?.(result.version);
      }
      setOpen(false);
      props.onEditingChange?.(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить связи");
      // Refresh parent CAS/projections after conflicts without silently discarding the draft.
      props.onChanged?.();
    }
  };
  const visible = props.disabled ? props.members ?? [] : candidates;
  const labels = new Map([...(props.members ?? []), ...candidates].map(c => [c.id, c.label]));
  return <>
    <button type="button" className="text-sm text-blue-700 underline underline-offset-4" onClick={() => changeOpen(true)}>
      {ids.length} записей
    </button>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Связанные записи ({selected.length})</DialogTitle></DialogHeader>
        {gated && <p role="status">Сначала выберите родительскую запись.</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {!props.disabled && <Input aria-label="Поиск связанных записей" value={search} onChange={e => setSearch(e.target.value)} />}
        {!props.disabled && <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={loading || busy || !!gated || !!error} onClick={() => setSelected(candidates.map(c => c.id))}>Выбрать все ({candidates.length})</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setSelected([])}>Очистить</Button>
        </div>}
        {!props.disabled && !gated && !loading && !error && createEntityId != null && props.renderQuickCreate &&
          <Button type="button" variant="outline" onClick={() => setCreateOpen(true)}>Создать связанную запись</Button>}
        <div className="max-h-72 overflow-y-auto space-y-2">
          {loading ? <p role="status">Загрузка…</p> : visible.filter(c => c.label.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(c =>
            <label key={c.id} className="flex items-center gap-2 rounded border p-2 text-sm">
              {!props.disabled && <input type="checkbox" checked={selected.includes(c.id)} disabled={busy || !!gated} onChange={e => setSelected(old => e.target.checked ? [...old, c.id] : old.filter(id => id !== c.id))} />}
              <span>{c.label || `#${c.id}`}</span>
            </label>)}
          {!loading && !error && visible.length === 0 && <p className="text-sm text-muted-foreground">Нет доступных записей</p>}
          {!props.disabled && selected.filter(id => !candidates.some(c => c.id === id)).map(id =>
            <div key={id} className="text-sm">{labels.get(id) ?? `#${id}`} <button type="button" disabled={busy} onClick={() => setSelected(old => old.filter(v => v !== id))}>Удалить</button></div>)}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={() => changeOpen(false)}>Закрыть</Button>
          {!props.disabled && <Button type="button" disabled={busy || loading || !!gated || !!error} onClick={() => void save()}>Сохранить выбор</Button>}
        </div>
      </DialogContent>
    </Dialog>
    {createEntityId != null && props.renderQuickCreate?.({
      open: createOpen, onOpenChange: setCreateOpen, relatedEntityId: createEntityId,
      onCreated: (id, label) => {
        setCandidates(old => [...old.filter(c => c.id !== id), { id, label: label ?? `#${id}` }]);
        setSelected(old => [...new Set([...old, id])]);
        setCreateOpen(false);
      },
    })}
  </>;
}