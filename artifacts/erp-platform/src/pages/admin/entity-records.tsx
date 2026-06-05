import { useParams, useLocation } from "wouter";
import {
  useListEntities,
  type Entity,
} from "@workspace/api-client-react";
import { ArrowLeft, Database } from "lucide-react";
import { EntityRecords } from "@/components/EntityRecords";
import { useML, useT } from "@/lib/i18n";

export default function EntityRecordsPage() {
  const ml = useML();
  const t = useT();
  const params = useParams();
  const entityId = Number(params.entityId);
  const [, navigate] = useLocation();

  const { data: entities = [] } = useListEntities();
  const entity = entities.find((e: Entity) => e.id === entityId);

  return (
    <div className="p-6 space-y-6">
      <div>
        <button
          onClick={() => navigate("/admin/entities")}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t("records.backToEntities", "К списку сущностей")}
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Database className="w-6 h-6 text-blue-600" />
            {`${t("records.title", "Данные")}${entity ? `: ${ml(entity.nameJson)}` : ""}`}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {t("records.entityRecords", "Записи сущности")}{entity ? <> <code className="text-xs">{entity.entityKey}</code></> : null}
          </p>
        </div>
      </div>

      <EntityRecords entityId={entityId} />
    </div>
  );
}
