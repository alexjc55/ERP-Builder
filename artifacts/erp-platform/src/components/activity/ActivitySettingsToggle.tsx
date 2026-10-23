import { useQueryClient } from "@tanstack/react-query";
import { useGetActivitySettings, getGetActivitySettingsQueryKey, useSaveActivitySettings } from "@workspace/api-client-react";
import { MessagesSquare } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiErrorMessage } from "@/lib/activity";
import { invalidateActivity, useActivityLabels } from "./activityShared";

/** Entity-level switch for the activity module (requires the entities admin cap). */
export function ActivitySettingsToggle({ entityId }: { entityId: number }) {
  const { t } = useActivityLabels();
  const { toast } = useToast();
  const qc = useQueryClient();
  const params = { entityId };
  const q = useGetActivitySettings(params, { query: { enabled: entityId > 0, queryKey: getGetActivitySettingsQueryKey(params) } });
  const save = useSaveActivitySettings({
    mutation: {
      onSuccess: (s) => {
        qc.setQueryData(getGetActivitySettingsQueryKey(params), s);
        void invalidateActivity(qc);
        toast({ title: s.enabled ? t("activity.settings.on", "Работа с клиентом включена") : t("activity.settings.off", "Работа с клиентом выключена") });
      },
      onError: (e) => toast({ variant: "destructive", title: t("activity.err.save", "Не удалось сохранить"), description: apiErrorMessage(e) }),
    },
  });
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3" data-testid="activity-settings">
      <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-800">{t("activity.settings.title", "Звонки, договорённости и задачи")}</p>
        <p className="text-xs text-slate-500">{t("activity.settings.desc", "Лента активности и следующие шаги в карточках записей этой сущности. Данные сохраняются при выключении.")}</p>
        {q.isError && <p className="mt-1 text-xs text-red-600">{apiErrorMessage(q.error)} <button type="button" className="underline" onClick={() => void q.refetch()}>{t("common.retry", "Повторить")}</button></p>}
      </div>
      {q.isLoading ? <Skeleton className="h-5 w-9" /> : (
        <Switch checked={q.data?.enabled === true} disabled={save.isPending || q.isError}
          onCheckedChange={v => save.mutate({ data: { entityId, enabled: v } })} data-testid="switch-activity-enabled" />
      )}
    </div>
  );
}
