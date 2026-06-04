import { useLocation } from "wouter";
import {
  useListPages,
  useListEntities,
  type Page,
  type Entity,
  type MultilingualText,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Construction, Loader2 } from "lucide-react";
import NotFound from "@/pages/not-found";
import { EntityRecords } from "@/components/EntityRecords";

function getML(val: MultilingualText | string | undefined | null): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  return val.ru || val.en || val.he || "";
}

export default function DynamicPage() {
  const [location] = useLocation();
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

  const entity = entities.find((e: Entity) => e.pageId === page.id && e.isActive);

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">{getML(page.nameJson)}</h1>
        {getML(page.descriptionJson) && (
          <p className="text-sm text-slate-500 mt-0.5">{getML(page.descriptionJson)}</p>
        )}
      </div>

      {entity ? (
        <EntityRecords entityId={entity.id} />
      ) : (
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="flex flex-col items-center justify-center text-center py-20 gap-3">
            <div className="w-12 h-12 rounded-full bg-amber-50 flex items-center justify-center">
              <Construction className="w-6 h-6 text-amber-500" />
            </div>
            <div>
              <p className="text-slate-700 font-medium">Страница создана, но не наполнена</p>
              <p className="text-sm text-slate-400 mt-1 max-w-md">
                К этой странице ещё не привязана сущность. Создайте сущность в конструкторе и
                выберите эту страницу для отображения.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
