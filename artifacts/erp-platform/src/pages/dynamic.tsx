import { useLocation } from "wouter";
import {
  useListPages,
  useListEntities,
  type Page,
  type Entity,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Construction, Loader2, ShieldAlert } from "lucide-react";
import NotFound from "@/pages/not-found";
import { EntityRecords } from "@/components/EntityRecords";
import DashboardView from "@/components/DashboardView";
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

      {page.isDashboard ? (
        <DashboardView pageId={page.id} />
      ) : entity ? (
        <EntityRecords
          entityId={entity.id}
          visibleFieldKeys={mirrorEntity ? page.mirrorFieldKeysJson ?? undefined : undefined}
          pageId={mirrorEntity ? page.id : undefined}
        />
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
