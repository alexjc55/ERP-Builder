import { useState } from "react";
import {
  useListDeletedFiles,
  useDeleteDeletedFile,
  usePurgeDeletedFiles,
  useListUsers,
  getListDeletedFilesQueryKey,
  type DeletedFile,
  type User,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useML, useT } from "@/lib/i18n";
import { downloadTrashedFile } from "@/lib/storage";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { Trash2, Download, Trash, FileX } from "lucide-react";

const REASON_BADGE: Record<string, string> = {
  record_deleted: "bg-red-100 text-red-700",
  field_cleared: "bg-amber-100 text-amber-700",
  field_replaced: "bg-blue-100 text-blue-700",
};

export default function FileTrashPage() {
  const ml = useML();
  const t = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useListDeletedFiles();
  const files: DeletedFile[] = data ?? [];

  const { data: usersData } = useListUsers({ limit: 500 });
  const users: User[] = usersData?.data ?? [];
  const userName = (id: number | null | undefined): string => {
    if (id == null) return "—";
    const u = users.find((x) => x.id === id);
    return u ? `${u.firstName} ${u.lastName}`.trim() || u.email : `#${id}`;
  };

  const [toDelete, setToDelete] = useState<DeletedFile | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListDeletedFilesQueryKey() });

  const deleteMutation = useDeleteDeletedFile({
    mutation: {
      onSuccess: () => {
        invalidate();
        setToDelete(null);
        toast({ title: t("fileTrash.deleted", "Файл удалён навсегда") });
      },
      onError: () =>
        toast({ title: t("fileTrash.deleteError", "Не удалось удалить файл"), variant: "destructive" }),
    },
  });

  const purgeMutation = usePurgeDeletedFiles({
    mutation: {
      onSuccess: () => {
        invalidate();
        setPurgeOpen(false);
        toast({ title: t("fileTrash.purged", "Корзина очищена") });
      },
      onError: () =>
        toast({ title: t("fileTrash.purgeError", "Не удалось очистить корзину"), variant: "destructive" }),
    },
  });

  const reasonLabel = (reason: string): string => {
    switch (reason) {
      case "record_deleted":
        return t("fileTrash.reason.recordDeleted", "Запись удалена");
      case "field_cleared":
        return t("fileTrash.reason.fieldCleared", "Поле очищено");
      case "field_replaced":
        return t("fileTrash.reason.fieldReplaced", "Файл заменён");
      default:
        return reason;
    }
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  const fmtSize = (size: number | null | undefined): string => {
    if (size == null) return "—";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDownload = async (f: DeletedFile) => {
    setDownloadingId(f.id);
    try {
      await downloadTrashedFile(f.id, f.fileName);
    } catch {
      toast({ title: t("fileTrash.downloadError", "Не удалось скачать файл"), variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("fileTrash.title", "Корзина файлов")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {t(
              "fileTrash.subtitle",
              "Локальные файлы, удалённые из записей. Их можно скачать для восстановления или удалить навсегда. Файлы Google Drive здесь не хранятся.",
            )}
          </p>
        </div>
        {files.length > 0 && (
          <Button variant="outline" className="text-red-600 hover:text-red-700" onClick={() => setPurgeOpen(true)}>
            <Trash className="w-4 h-4 mr-1.5" />
            {t("fileTrash.purgeAll", "Очистить корзину")}
          </Button>
        )}
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("fileTrash.col.file", "Файл")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("fileTrash.col.origin", "Откуда")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-36">{t("fileTrash.col.reason", "Причина")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-40">{t("fileTrash.col.deletedBy", "Кто удалил")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-44">{t("fileTrash.col.deletedAt", "Когда")}</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 w-40">{t("fileTrash.col.actions", "Действия")}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : files.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                      <FileX className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      {t("fileTrash.empty", "Корзина пуста")}
                    </td>
                  </tr>
                ) : (
                  files.map((f) => (
                    <tr key={f.id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-700 break-all">{f.fileName}</div>
                        <div className="text-xs text-slate-400">
                          {fmtSize(f.fileSize)}
                          {f.contentType ? ` · ${f.contentType}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <div>{f.entityName ? ml(f.entityName) : f.entityId != null ? `#${f.entityId}` : "—"}</div>
                        <div className="text-xs text-slate-400">
                          {t("fileTrash.field", "Поле")}: {f.fieldName ? ml(f.fieldName) : f.fieldKey}
                          {f.recordId != null ? ` · ${t("fileTrash.record", "Запись")} #${f.recordId}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={REASON_BADGE[f.reason] || "bg-slate-100 text-slate-700"}>
                          {reasonLabel(f.reason)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{userName(f.deletedBy)}</td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(f.deletedAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={downloadingId === f.id}
                            onClick={() => handleDownload(f)}
                          >
                            <Download className="w-3.5 h-3.5 mr-1" />
                            {t("fileTrash.download", "Скачать")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-500 hover:text-red-600"
                            title={t("fileTrash.deleteForever", "Удалить навсегда")}
                            onClick={() => setToDelete(f)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("fileTrash.deleteConfirmTitle", "Удалить файл навсегда?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "fileTrash.deleteConfirmDesc",
                "Файл будет безвозвратно удалён из хранилища. Это действие нельзя отменить.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("fileTrash.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (toDelete) deleteMutation.mutate({ id: toDelete.id });
              }}
            >
              {t("fileTrash.deleteForever", "Удалить навсегда")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={purgeOpen} onOpenChange={setPurgeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("fileTrash.purgeConfirmTitle", "Очистить всю корзину?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "fileTrash.purgeConfirmDesc",
                "Все файлы в корзине будут безвозвратно удалены из хранилища. Это действие нельзя отменить.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("fileTrash.cancel", "Отмена")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              disabled={purgeMutation.isPending}
              onClick={() => purgeMutation.mutate()}
            >
              {t("fileTrash.purgeAll", "Очистить корзину")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
