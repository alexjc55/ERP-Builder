import { useState } from "react";
import {
  useListPages,
  useCreatePage,
  useUpdatePage,
  useDeletePage,
  type Page,
  type MultilingualText,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { MultilingualInput } from "@/components/MultilingualInput";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Layout, Loader2, ChevronRight } from "lucide-react";

type MLValue = { ru?: string; en?: string; he?: string };

function getML(val: MultilingualText | string | undefined | null): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.ru || val.en || val.he || "";
}

export default function PagesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPage, setEditingPage] = useState<Page | null>(null);
  const [deletePage, setDeletePage] = useState<Page | null>(null);

  const [nameJson, setNameJson] = useState<MLValue>({});
  const [descJson, setDescJson] = useState<MLValue>({});
  const [icon, setIcon] = useState("");
  const [parentPageId, setParentPageId] = useState<string>("none");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);

  const { data: pages = [], isLoading } = useListPages();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/pages"] });

  const createMutation = useCreatePage({
    mutation: {
      onSuccess: () => { toast({ title: "Страница создана" }); setDialogOpen(false); invalidate(); },
      onError: () => toast({ title: "Ошибка создания страницы", variant: "destructive" }),
    },
  });

  const updateMutation = useUpdatePage({
    mutation: {
      onSuccess: () => { toast({ title: "Страница обновлена" }); setDialogOpen(false); invalidate(); },
    },
  });

  const deleteMutation = useDeletePage({
    mutation: {
      onSuccess: () => { toast({ title: "Страница удалена" }); setDeletePage(null); invalidate(); },
      onError: () => toast({ title: "Нельзя удалить страницу с дочерними", variant: "destructive" }),
    },
  });

  const openCreate = () => {
    setEditingPage(null);
    setNameJson({});
    setDescJson({});
    setIcon("");
    setParentPageId("none");
    setSortOrder(pages.length + 1);
    setIsActive(true);
    setDialogOpen(true);
  };

  const openEdit = (page: Page) => {
    setEditingPage(page);
    const n = page.nameJson;
    const d = page.descriptionJson;
    setNameJson(typeof n === "object" && n ? { ru: n.ru, en: n.en, he: n.he } : {});
    setDescJson(typeof d === "object" && d ? { ru: d.ru, en: d.en, he: d.he } : {});
    setIcon(page.icon || "");
    setParentPageId(page.parentPageId ? String(page.parentPageId) : "none");
    setSortOrder(page.sortOrder);
    setIsActive(page.isActive);
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    const payload = {
      nameJson: nameJson as MultilingualText,
      descriptionJson: descJson as MultilingualText,
      icon: icon || "",
      parentPageId: parentPageId !== "none" ? Number(parentPageId) : undefined,
      sortOrder,
      isActive,
    };
    if (editingPage) {
      updateMutation.mutate({ id: editingPage.id, data: payload });
    } else {
      createMutation.mutate({ data: payload });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const topPages = pages.filter((p: Page) => !p.parentPageId);
  const subPages = (parentId: number) => pages.filter((p: Page) => p.parentPageId === parentId);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Страницы</h1>
          <p className="text-sm text-slate-500 mt-0.5">Управление навигацией и пунктами меню</p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700 gap-2">
          <Plus className="w-4 h-4" />
          Создать страницу
        </Button>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : pages.length === 0 ? (
            <div className="text-center py-16 text-slate-400">Страницы не найдены</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Название</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Иконка</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Порядок</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Статус</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Действия</th>
                </tr>
              </thead>
              <tbody>
                {topPages.sort((a: Page, b: Page) => a.sortOrder - b.sortOrder).map((page: Page) => {
                  const children = subPages(page.id).sort((a: Page, b: Page) => a.sortOrder - b.sortOrder);
                  return [
                    <tr key={page.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Layout className="w-4 h-4 text-slate-400" />
                          <span className="font-medium text-slate-700">{getML(page.nameJson)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{page.icon || "—"}</td>
                      <td className="px-4 py-3 text-slate-500">{page.sortOrder}</td>
                      <td className="px-4 py-3">
                        {page.isActive ? (
                          <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">Активна</Badge>
                        ) : (
                          <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">Скрыта</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(page)}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeletePage(page)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>,
                    ...children.map((child: Page) => (
                      <tr key={child.id} className="border-b border-slate-100 hover:bg-slate-50 bg-slate-50/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 pl-6">
                            <ChevronRight className="w-3.5 h-3.5 text-slate-300" />
                            <span className="text-slate-600">{getML(child.nameJson)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{child.icon || "—"}</td>
                        <td className="px-4 py-3 text-slate-500">{child.sortOrder}</td>
                        <td className="px-4 py-3">
                          {child.isActive ? (
                            <Badge className="bg-emerald-100 text-emerald-700 border-0 font-normal">Активна</Badge>
                          ) : (
                            <Badge className="bg-slate-100 text-slate-500 border-0 font-normal">Скрыта</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(child)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => setDeletePage(child)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  ];
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPage ? "Редактировать страницу" : "Новая страница"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <MultilingualInput label="Название" value={nameJson} onChange={setNameJson} required />
            <MultilingualInput label="Описание" value={descJson} onChange={setDescJson} multiline />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Иконка</Label>
                <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="layout-dashboard" />
              </div>
              <div className="space-y-1.5">
                <Label>Порядок</Label>
                <Input type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Родительская страница</Label>
              <Select value={parentPageId} onValueChange={setParentPageId}>
                <SelectTrigger><SelectValue placeholder="Корневая страница" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Корневая —</SelectItem>
                  {topPages.filter((p: Page) => !editingPage || p.id !== editingPage.id).map((p: Page) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {getML(p.nameJson)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} id="page-active" />
              <Label htmlFor="page-active">Активна (видна в меню)</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
            <Button onClick={handleSubmit} disabled={isPending} className="bg-blue-600 hover:bg-blue-700">
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : editingPage ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deletePage} onOpenChange={(o) => !o && setDeletePage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить страницу?</AlertDialogTitle>
            <AlertDialogDescription>
              "{getML(deletePage?.nameJson)}" будет удалена безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deletePage && deleteMutation.mutate({ id: deletePage.id })}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
