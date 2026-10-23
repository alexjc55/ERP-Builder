import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useListCardStylePresets, getListCardStylePresetsQueryKey, createCardStylePreset, updateCardStylePreset, deleteCardStylePreset, type CardStylePreset } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/activity";
import { applyCardAppearance, captureCardAppearance } from "@/lib/cardAppearancePresets";
import type { CardLayout } from "@/lib/cardLayout";

export function CardStylePresets({ layout, onChange }: {
  layout: CardLayout; onChange: (fn: (layout: CardLayout) => CardLayout) => void;
}) {
  const t = useT(), qc = useQueryClient(), { toast } = useToast();
  const query = useListCardStylePresets({ query: {
    queryKey: getListCardStylePresetsQueryKey(), refetchOnWindowFocus: true,
  } });
  const [selected, setSelected] = useState<CardStylePreset | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"update" | "delete" | null>(null);
  const save = async (action: "create" | "update" | "delete") => {
    setBusy(true);
    try {
      const data = { name: name.trim(), appearance: captureCardAppearance(layout) };
      if (action === "delete" && selected) {
        await deleteCardStylePreset(selected.id, { expectedRevision: selected.revision });
        setSelected(null); setName("");
      } else {
        const saved = action === "update" && selected
          ? await updateCardStylePreset(selected.id, { ...data, expectedRevision: selected.revision })
          : await createCardStylePreset(data);
        setSelected(saved); setName(saved.name);
      }
      await qc.invalidateQueries({ queryKey: getListCardStylePresetsQueryKey() });
      toast({ title: t("cards.appearanceSaved", "Список шаблонов оформления обновлён") });
    } catch (error) {
      toast({ title: t("cards.appearanceError", "Не удалось сохранить изменения"), description: apiErrorMessage(error), variant: "destructive" });
      void query.refetch();
    } finally { setBusy(false); setConfirm(null); }
  };
  return <fieldset disabled={busy} className="space-y-2 rounded-lg border bg-slate-50 p-3" data-testid="card-style-presets">
    <Label htmlFor="card-style-preset">{t("cards.appearanceLibrary", "Шаблоны оформления")}</Label>
    <p className="text-xs text-slate-500">{t("cards.appearanceHint", "Общие для проекта. Применяется только оформление — поля и структура не меняются. Затем сохраните карточку.")}</p>
    {query.isError ? <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>{t("cards.appearanceRetry", "Не удалось загрузить. Повторить")}</Button> :
      <select id="card-style-preset" className="w-full rounded-md border bg-white p-2 text-sm" disabled={query.isLoading}
        value={selected?.id ?? ""} onChange={e => {
          const next = query.data?.find(item => item.id === Number(e.target.value)) ?? null;
          setSelected(next); setName(next?.name ?? "");
        }}>
        <option value="">{t("cards.appearanceChoose", "Выберите шаблон")}</option>
        {(query.data ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>}
    <Button type="button" size="sm" className="w-full" disabled={!selected} data-testid="apply-card-style"
      onClick={() => selected && onChange(current => applyCardAppearance(current, selected.appearance))}>
      {t("cards.appearanceApply", "Применить оформление")}
    </Button>
    <Label htmlFor="card-style-name">{t("cards.appearanceName", "Название шаблона оформления")}</Label>
    <Input id="card-style-name" value={name} maxLength={120} onChange={e => setName(e.target.value)} />
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={!name.trim()} onClick={() => void save("create")} data-testid="create-card-style">
        {t("cards.appearanceCreate", "Сохранить как новый")}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={!selected || !name.trim()} onClick={() => setConfirm("update")}>
        {t("cards.appearanceUpdate", "Обновить выбранный")}
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={!selected} onClick={() => setConfirm("delete")}>
        {t("cards.appearanceDelete", "Удалить шаблон")}
      </Button>
    </div>
    <AlertDialog open={confirm !== null} onOpenChange={open => !open && !busy && setConfirm(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm === "delete" ? t("cards.appearanceDelete", "Удалить шаблон") : t("cards.appearanceUpdate", "Обновить выбранный")}: {selected?.name}</AlertDialogTitle>
          <AlertDialogDescription>{t("cards.appearanceConfirm", "Это изменит общий список шаблонов проекта. Оформление уже сохранённых карточек останется прежним.")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{t("common.cancel", "Отмена")}</AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={e => { e.preventDefault(); if (confirm) void save(confirm); }}>
            {t("common.confirm", "Подтвердить")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </fieldset>;
}
