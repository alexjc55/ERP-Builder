import { useState } from "react";
import { createEntityFolder, updateEntityFolder, deleteEntityFolder, getListEntityFoldersQueryKey, getListEntitiesQueryKey, type EntityFolder, type MultilingualText } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MultilingualInput } from "@/components/MultilingualInput";
import { useML, useT } from "@/lib/i18n";
import { Pencil, Trash2, FolderPlus } from "lucide-react";

export function EntityFolderActions({ folder, count = 0 }: { folder?: EntityFolder; count?: number }) {
  const t = useT();
  const ml = useML();
  const client = useQueryClient();
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [name, setName] = useState<MultilingualText>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = (next: "edit" | "delete") => { setName(folder?.nameJson ?? {}); setError(""); setMode(next); };
  const save = async () => {
    setBusy(true); setError("");
    try {
      if (mode === "delete" && folder) await deleteEntityFolder(folder.id);
      else if (folder) await updateEntityFolder(folder.id, { nameJson: name });
      else await createEntityFolder({ nameJson: name });
      await Promise.all([
        client.invalidateQueries({ queryKey: getListEntityFoldersQueryKey() }),
        client.invalidateQueries({ queryKey: getListEntitiesQueryKey() }),
      ]);
      setMode(null);
    } catch { setError(t("common.error", "Ошибка. Попробуйте ещё раз.")); }
    finally { setBusy(false); }
  };
  return <>
    {folder ? <span className="inline-flex gap-1">
      <Button variant="ghost" size="icon" aria-label={`${t("common.edit", "Редактировать")} ${ml(folder.nameJson)}`} onClick={() => open("edit")}><Pencil className="w-4 h-4" /></Button>
      <Button variant="ghost" size="icon" aria-label={`${t("common.delete", "Удалить")} ${ml(folder.nameJson)}`} onClick={() => open("delete")}><Trash2 className="w-4 h-4" /></Button>
    </span> : <Button variant="outline" onClick={() => open("edit")}><FolderPlus className="w-4 h-4 me-2" />{t("auto.createFolder", "Создать папку")}</Button>}
    <Dialog open={!!mode} onOpenChange={v => { if (!v && !busy) setMode(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{mode === "delete" ? t("auto.deleteFolder", "Удалить папку") : t("auto.folderName", "Название папки")}</DialogTitle>
          <DialogDescription>{mode === "delete"
            ? `${t("entityFolders.deleteHint", "Удаляется только папка. Сущности останутся в разделе «Без папки». Количество:")} ${count}`
            : t("entityFolders.hint", "Папки служат только для группировки списка и не меняют права доступа.")}</DialogDescription>
        </DialogHeader>
        {mode === "edit" && <MultilingualInput label={t("auto.folderName", "Название папки")} value={name} onChange={setName} required />}
        {error && <p role="alert" className="text-red-600">{error}</p>}
        <Button disabled={busy || (mode === "edit" && !Object.values(name).some(v => v?.trim()))} onClick={() => void save()}>
          {busy ? t("common.saving", "Сохранение…") : mode === "delete" ? t("common.delete", "Удалить") : t("common.save", "Сохранить")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => setMode(null)}>{t("common.cancel", "Отмена")}</Button>
      </DialogContent>
    </Dialog>
  </>;
}
