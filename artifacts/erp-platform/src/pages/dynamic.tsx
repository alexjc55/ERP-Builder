import { useLocation } from "wouter";
import {
  useListPages,
  useListEntities,
  type Page,
  type Entity,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Construction, Loader2, ShieldAlert, TableProperties } from "lucide-react";
import NotFound from "@/pages/not-found";
import { EntityRecords } from "@/components/EntityRecords";
import DashboardView from "@/components/DashboardView";
import { useGetPivotPageData } from "@workspace/api-client-react";
import { PivotResultTable } from "@/components/PivotView";
import { useAuth } from "@/lib/auth";
import { useML, useT } from "@/lib/i18n";

export default function DynamicPage() {
  const ml = useML();
  const t = useT();
  const [location] = useLocation();
  const { canPage } = useAuth();
  const { data: pages = [], isLoading: pagesLoading } = useListPages();
  const { data: entities = [], isLoading: entitiesLoading } = useListEntities();

  if (pagesLoading || entitiesLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const page = pages.find((p: Page) => p.path && p.path === location);

  if (!page) {
    return <NotFound />;
  }

  if (!canPage(page.id)) {
    return (
      <div className="p-6">
        <div className="max-w-md mx-auto mt-16 text-center space-y-3">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-7 h-7 text-red-500" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800">{t("page.accessDenied", "Доступ запрещён")}</h1>
          <p className="text-sm text-slate-500">
            {t("page.accessDeniedDesc", "У вас нет прав для просмотра этой страницы. Обратитесь к администратору.")}
          </p>
        </div>
      </div>
    );
  }

  // A mirror page displays the live records of an existing ("source") entity,
  // optionally projected to a chosen subset of fields. The source entity must
  // still exist and be active. Real security (per-client row scope, hidden
  // fields) is enforced server-side by RBAC on the mirrored entity.
  const mirrorEntity =
    page.mirrorEntityId != null
      ? entities.find((e: Entity) => e.id === page.mirrorEntityId && e.isActive)
      : undefined;
  const entity = mirrorEntity ?? entities.find((e: Entity) => e.pageId === page.id && e.isActive);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{ml(page.nameJson)}</h1>
        {ml(page.descriptionJson) && (
          <p className="text-sm text-slate-500 mt-0.5">{ml(page.descriptionJson)}</p>
        )}
      </div>

      {page.isPivot ? (
        <PivotPageView pageId={page.id} />
      ) : page.isDashboard ? (
        <DashboardView pageId={page.id} />
      ) : entity ? (
        <>
          {/* Analytics widgets (same engine as dashboards) above the records
              table. Rendered as a sibling here — NOT inside EntityRecords —
              so it bypasses EntityRecords' record-view/no-fields gating:
              widget role-visibility and the "pages" admin cap are independent
              of entity record:view. */}
          <DashboardView pageId={page.id} embedded />
          <EntityRecords
            entityId={entity.id}
            visibleFieldKeys={mirrorEntity ? page.mirrorFieldKeysJson ?? undefined : undefined}
            fieldLabelOverrides={mirrorEntity ? page.mirrorFieldLabelsJson ?? undefined : undefined}
            mirrorColumnOrder={mirrorEntity ? page.mirrorColumnOrderJson ?? undefined : undefined}
            columnGroups={page.columnGroupsJson ?? undefined}
            mirrorPinned={mirrorEntity ? page.mirrorPinnedJson ?? undefined : undefined}
            pageId={page.id}
            isMirror={Boolean(mirrorEntity)}
            defaultQuickFilter={page.defaultQuickFilterJson ?? undefined}
            customFilters={page.customFiltersJson ?? undefined}
            groupByFieldKey={mirrorEntity ? page.groupByFieldKey ?? undefined : undefined}
            groupDefaultExpanded={mirrorEntity ? page.groupDefaultExpanded ?? undefined : undefined}
          />
        </>
      ) : (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center text-center py-20 gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
              <Construction className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <p className="text-slate-700 font-medium">{t("page.emptyTitle", "Страница создана, но не наполнена")}</p>
              <p className="text-sm text-slate-400 mt-1 max-w-md">
                {t("page.emptyDesc", "К этой странице ещё не привязана сущность. Создайте сущность в конструкторе и выберите эту страницу для отображения.")}
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Renders a PIVOT PAGE's cross-tab. The totals are ADMIN-AUTHORITATIVE (computed
 * server-side over ALL the entity's records matching the page's configured
 * filters), shipped only to viewers with page access — the access gate runs on the
 * server before any aggregation. Display-only: this component never aggregates.
 */
function PivotPageView({ pageId }: { pageId: number }) {
  const t = useT();
  const { data: result, isLoading, isError } = useGetPivotPageData(pageId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-slate-400">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t("pivot.loading", "Строим сводную…")}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        {t("pivot.error", "Не удалось построить сводную таблицу")}
      </div>
    );
  }
  if (!result || result.rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-slate-400">
        <TableProperties className="w-8 h-8 opacity-50" />
        <p className="text-sm">{t("pivot.empty", "Нет данных для сводной таблицы")}</p>
      </div>
    );
  }
  return <PivotResultTable result={result} />;
}
