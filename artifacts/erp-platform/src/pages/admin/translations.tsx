import { useState } from "react";
import {
  useListTranslations,
  useCreateTranslation,
  useUpdateTranslation,
  type Translation,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Search, Pencil, Loader2, Languages, Filter } from "lucide-react";

export default function TranslationsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTrans, setEditingTrans] = useState<Translation | null>(null);
  const [key, setKey] = useState("");
  const [ru, setRu] = useState("");
  const [en, setEn] = useState("");
  const [he, setHe] = useState("");

  const [onlyUntranslated, setOnlyUntranslated] = useState(false);

  const { data: allTranslations = [], isLoading } = useListTranslations();

  const isUntranslated = (t: Translation): boolean => {
    const tj = (t.translationsJson || {}) as { ru?: string; en?: string; he?: string };
    const ru = (tj.ru || "").trim();
    const en = (tj.en || "").trim();
    const he = (tj.he || "").trim();
    if (en === "" || he === "") return true;
    if (ru !== "" && (en === ru || he === ru)) return true;
    return false;
  };

  const untranslatedCount = allTranslations.filter(isUntranslated).length;

  const translations = allTranslations.filter((t: Translation) => {
    if (onlyUntranslated && !isUntranslated(t)) return false;
    if (!search) return true;
    return (
      t.translationKey.toLowerCase().includes(search.toLowerCase()) ||
      Object.values(t.translationsJson || {}).some((v) =>
        (v as string).toLowerCase().includes(search.toLowerCase()),
      )
    );
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/translations"] });

  const createMutation = useCreateTranslation({
    mutation: {
      onSuccess: () => { toast({ title: "Перевод добавлен" }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: "Ошибка: ключ уже существует", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateTranslation({
    mutation: {
      onSuccess: () => { toast({ title: "Перевод обновлён" }); setDialogOpen(false); invalidate(); },
    },
  });

  const openCreate = () => {
    setEditingTrans(null);
    setKey(""); setRu(""); setEn(""); setHe("");
    setDialogOpen(true);
  };

  const openEdit = (t: Translation) => {
    setEditingTrans(t);
    setKey(t.translationKey);
    const tj = t.translationsJson as { ru?: string; en?: string; he?: string } | undefined;
    setRu(tj?.ru || "");
    setEn(tj?.en || "");
    setHe(tj?.he || "");
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const translationsJson: { ru?: string; en?: string; he?: string } = {};
    if (ru) translationsJson.ru = ru;
    if (en) translationsJson.en = en;
    if (he) translationsJson.he = he;

    if (editingTrans) {
      updateMutation.mutate({ key: editingTrans.translationKey, data: { translationsJson } });
    } else {
      createMutation.mutate({ data: { translationKey: key, translationsJson } });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Переводы</h1>
          <p className="text-sm text-slate-500 mt-0.5">Управление многоязычным контентом (ru/en/he)</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          Добавить перевод
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Поиск по ключу или тексту..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          variant={onlyUntranslated ? "default" : "outline"}
          onClick={() => setOnlyUntranslated((v) => !v)}
          className={onlyUntranslated ? "bg-amber-500 hover:bg-amber-600 gap-2" : "gap-2"}
        >
          <Filter className="w-4 h-4" />
          Только непереведённые
          {untranslatedCount > 0 && (
            <span
              className={
                "ml-1 rounded-full px-1.5 py-0.5 text-xs " +
                (onlyUntranslated ? "bg-white/25 text-white" : "bg-amber-100 text-amber-700")
              }
            >
              {untranslatedCount}
            </span>
          )}
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-56">Ключ</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">RU</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">EN</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">HE</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Действия</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : translations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-slate-400">
                      <Languages className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      Переводы не найдены
                    </td>
                  </tr>
                ) : (
                  translations.map((t: Translation) => {
                    const tj = t.translationsJson as { ru?: string; en?: string; he?: string } | undefined;
                    return (
                      <tr key={t.translationKey} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <code className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                            {t.translationKey}
                          </code>
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">
                          {tj?.ru || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">
                          {tj?.en || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate" dir="rtl">
                          {tj?.he || <span className="text-slate-300" dir="ltr">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(t)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingTrans ? "Редактировать перевод" : "Новый перевод"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Ключ *</Label>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="nav.dashboard"
                disabled={!!editingTrans}
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Русский (RU)</Label>
              <Input value={ru} onChange={(e) => setRu(e.target.value)} placeholder="Текст на русском" />
            </div>
            <div className="space-y-1.5">
              <Label>English (EN)</Label>
              <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder="English text" />
            </div>
            <div className="space-y-1.5">
              <Label>עברית (HE)</Label>
              <Input value={he} onChange={(e) => setHe(e.target.value)} placeholder="טקסט בעברית" dir="rtl" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleSubmit} disabled={isPending || !key} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingTrans ? "Сохранить" : "Добавить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
