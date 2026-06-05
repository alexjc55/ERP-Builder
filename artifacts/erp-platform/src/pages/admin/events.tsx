import { useState } from "react";
import {
  useListEvents,
  useListEntities,
  type SystemEvent,
  type Entity,
} from "@workspace/api-client-react";
import { useML, useT } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 50;

const EVENT_NAMES = [
  "record.created",
  "record.updated",
  "record.deleted",
  "status.changed",
  "user.created",
] as const;

const EVENT_BADGE: Record<string, string> = {
  "record.created": "bg-emerald-100 text-emerald-700",
  "record.updated": "bg-blue-100 text-blue-700",
  "record.deleted": "bg-red-100 text-red-700",
  "status.changed": "bg-amber-100 text-amber-700",
  "user.created": "bg-violet-100 text-violet-700",
};

export default function EventsPage() {
  const ml = useML();
  const t = useT();
  const [eventName, setEventName] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data: entitiesData } = useListEntities();
  const entities: Entity[] = entitiesData ?? [];
  const entityName = (id: number | null | undefined): string => {
    if (id == null) return "—";
    const e = entities.find((x) => x.id === id);
    return e ? ml(e.nameJson) : `#${id}`;
  };

  const { data, isLoading } = useListEvents({
    ...(eventName !== "all" ? { eventName } : {}),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const events: SystemEvent[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{t("events.title", "События")}</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {t("events.subtitle", "Журнал системных событий (основа для автоматизаций)")}
          </p>
        </div>
        <div className="w-56">
          <Select
            value={eventName}
            onValueChange={(v) => {
              setEventName(v);
              setPage(0);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("events.filter.all", "Все события")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("events.filter.all", "Все события")}</SelectItem>
              {EVENT_NAMES.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-44">{t("events.col.time", "Время")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-40">{t("events.col.event", "Событие")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("events.col.entity", "Сущность")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-24">{t("events.col.record", "Запись")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 w-40">{t("events.col.actor", "Пользователь")}</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">{t("events.col.payload", "Данные")}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      {Array.from({ length: 6 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : events.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-400">
                      <Activity className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      {t("events.empty", "Событий пока нет")}
                    </td>
                  </tr>
                ) : (
                  events.map((ev: SystemEvent) => (
                    <tr key={ev.id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtDate(ev.createdAt)}</td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className={EVENT_BADGE[ev.eventName] || "bg-slate-100 text-slate-700"}>
                          {ev.eventName}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{entityName(ev.entityId)}</td>
                      <td className="px-4 py-3 text-slate-600">{ev.recordId ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-600">{ev.actorName ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-500 max-w-[280px]">
                        <code className="text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono break-all">
                          {JSON.stringify(ev.payloadJson)}
                        </code>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>
            {t("events.pagination.total", "Всего")}: {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span>
              {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
