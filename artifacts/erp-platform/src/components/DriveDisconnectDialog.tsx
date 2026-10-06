import { useEffect, useState } from "react";
import { useDisconnectGoogleDrive, useGetGoogleDriveDisconnectPreview, getGetGoogleDriveDisconnectPreviewQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export function DriveDisconnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const { toast } = useToast();
  const client = useQueryClient();
  const [choice, setChoice] = useState<"keep" | "forget">("keep");
  const [confirmed, setConfirmed] = useState(false);
  const preview = useGetGoogleDriveDisconnectPreview({ query: { queryKey: getGetGoogleDriveDisconnectPreviewQueryKey(), enabled: open, staleTime: 0 } });
  const mutation = useDisconnectGoogleDrive();
  useEffect(() => { if (open) { setChoice("keep"); setConfirmed(false); } }, [open]);
  useEffect(() => { setConfirmed(false); }, [preview.data?.revision]);
  const submit = async () => {
    if (!preview.data || preview.isFetching || preview.isError || (choice === "forget" && !confirmed)) return;
    try {
      await mutation.mutateAsync({ data: { folderAction: choice, revision: preview.data.revision } });
      // Forget changes both kinds of field config, not just the connection card.
      await client.invalidateQueries();
      onOpenChange(false);
      toast({ title: t("gdrive.disconnected", "Google Drive отключён") });
    } catch {
      setConfirmed(false);
      void preview.refetch();
      toast({ title: t("gdrive.disconnectFlow.error", "Отключение не выполнено. Проверьте обновлённые данные и повторите."), variant: "destructive" });
    }
  };
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!mutation.isPending) onOpenChange(value); }}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("gdrive.disconnectConfirmTitle", "Отключить Google Drive?")}</DialogTitle>
          <DialogDescription>{t("gdrive.disconnectFlow.intro", "Авторизация будет отключена. Выберите, что сделать с настройками папок. Сами папки и файлы в Google Drive не удаляются.")}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={mutation.isPending} className="space-y-3">
          <legend className="sr-only">{t("gdrive.disconnectFlow.choice", "Что сделать с папками?")}</legend>
          <label className="flex gap-3 rounded-md border p-3 cursor-pointer">
            <input type="radio" name="drive-folder-action" value="keep" checked={choice === "keep"} onChange={() => { setChoice("keep"); setConfirmed(false); }} />
            <span>{t("gdrive.disconnectFlow.keep", "Сохранить папки и привязки для следующего подключения к этому аккаунту (рекомендуется)")}</span>
          </label>
          <label className="flex gap-3 rounded-md border p-3 cursor-pointer">
            <input type="radio" name="drive-folder-action" value="forget" checked={choice === "forget"} onChange={() => { setChoice("forget"); setConfirmed(false); }} />
            <span>{t("gdrive.disconnectFlow.forget", "Удалить список папок и их идентификаторы из настроек полей ERP")}</span>
          </label>
        </fieldset>
        <p className="text-sm text-muted-foreground">{t("gdrive.disconnectFlow.countHint", "Показаны поля с назначенной папкой и записи с файлами Google Drive в этих полях, включая архивные. Это не сканирование содержимого папок на Google Drive. Одна запись может учитываться у нескольких папок.")}</p>
        {preview.isFetching && <p role="status">{t("common.loading", "Загрузка…")}</p>}
        {preview.isError && <div role="alert">
          <p>{t("gdrive.disconnectFlow.loadError", "Не удалось проверить использование папок. Отключение недоступно.")}</p>
          <Button variant="outline" onClick={() => void preview.refetch()}>{t("common.retry", "Повторить")}</Button>
        </div>}
        {preview.data && !preview.isError && <div className="overflow-x-auto">
          <table className="w-full text-sm text-start">
            <thead><tr>
              <th className="p-2 text-start">{t("gdrive.disconnectFlow.folder", "Папка")}</th>
              <th className="p-2">{t("gdrive.disconnectFlow.fields", "Поля")}</th>
              <th className="p-2">{t("gdrive.disconnectFlow.entities", "Сущности")}</th>
              <th className="p-2">{t("gdrive.disconnectFlow.pages", "Страницы")}</th>
              <th className="p-2">{t("gdrive.disconnectFlow.records", "Записи с файлами")}</th>
            </tr></thead>
            <tbody>{preview.data.folders.map((folder) => <tr key={folder.folderId} className="border-t">
              <td className="p-2 break-all">{folder.name}</td>
              <td className="p-2 text-center">{folder.fields}</td>
              <td className="p-2 text-center">{folder.entities}</td>
              <td className="p-2 text-center">{folder.pages}</td>
              <td className="p-2 text-center">{folder.records}</td>
            </tr>)}</tbody>
          </table>
          {preview.data.folders.length === 0 && <p>{t("gdrive.disconnectFlow.empty", "Сохранённых папок и привязок нет.")}</p>}
        </div>}
        {choice === "forget" && <label className="flex gap-3 rounded-md border border-red-300 p-3 text-sm">
          <input type="checkbox" checked={confirmed} disabled={mutation.isPending} onChange={(e) => setConfirmed(e.target.checked)} />
          <span>{t("gdrive.disconnectFlow.confirmForget", "Подтверждаю удаление каталога папок, его шаблонов и назначений папок в полях. Автоматически они не восстановятся. Сохранённые файлы в записях останутся; новые назначения папок потребуется настроить заново.")}</span>
        </label>}
        <DialogFooter>
          <Button variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>{t("common.cancel", "Отмена")}</Button>
          <Button variant={choice === "forget" ? "destructive" : "default"} onClick={submit}
            disabled={!preview.data || preview.isFetching || preview.isError || mutation.isPending || (choice === "forget" && !confirmed)}>
            {t("gdrive.disconnect", "Отключить")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
