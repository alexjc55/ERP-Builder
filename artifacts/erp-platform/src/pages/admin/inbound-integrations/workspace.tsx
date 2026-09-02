import { JsonTree } from "./JsonTree";
import { useState, useEffect, useMemo, useRef, useId } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetInboundIntegration,
  useAnalyzeInboundSample,
  useCreateInboundMappingDraft,
  usePublishInboundMapping,
  useDryRunInboundMapping,
  useGetInboundDelivery,
  useReprocessInboundDelivery,
  useListEntities,
  useListEntityFields,
  useListEntityRelations,
  useListPages,
  useListPageFields,
  useListRoles,
  getGetInboundDeliveryQueryKey,
  getListEntityFieldsQueryKey,
  getListEntityRelationsQueryKey,
  getListPageFieldsQueryKey,
  type InboundDryRunResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useML, useT } from "@/lib/i18n";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Plus, Save, Play, CheckCircle2, AlertTriangle, FileJson, Link as LinkIcon, List, Check,
  ChevronDown, ChevronRight, X, LayoutTemplate, BoxSelect, Trash2, Webhook, Copy, Search, HelpCircle,
  Settings2
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type InboundOperand =
  | { kind: "source"; path: string }
  | { kind: "result"; step: string; property?: "id" }
  | { kind: "static"; value: unknown };

export type InboundTransform =
  | "trim" | "lower" | "upper" | "normalize_email" | "normalize_phone"
  | "string" | "number" | "boolean" | "date";

export interface InboundValue {
  operand: InboundOperand;
  transforms?: InboundTransform[];
}

export interface InboundMatch {
  kind: "system_id" | "external" | "fields";
  value?: InboundValue;
  maxValueExclusive?: number;
  objectType?: string;
  conditions?: { fieldKey: string; value: InboundValue }[];
  onMissingExplicitId?: "error" | "continue";
  skipWhenEmpty?: boolean;
}

export interface InboundStep {
  key: string;
  source?: string;
  target: 
    | { kind: "entity" | "page"; entityId: number; pageId?: number }
    | { kind: "user"; fieldId: number; roleId: number; entityId?: never; pageId?: never };
  operation: "find" | "create" | "update" | "upsert";
  matches?: InboundMatch[];
  values?: Record<string, InboundValue>;
  files?: { fieldKey: string; source: string; tag: string }[];
  updateOnMatch?: boolean;
  links?: { relationId: number; toStep: string }[];
  _uiEntityId?: number;
}

export interface InboundMapping {
  atomic?: boolean;
  steps: InboundStep[];
}

export interface AnalyzedPath {
  path: string;
  type: string;
  sample?: unknown;
}

export default function InboundIntegrationWorkspacePage() {
  const { id } = useParams();
  const integrationId = Number(id);
  const [, setLocation] = useLocation();
  const t = useT();
  const ml = useML();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: integration, isLoading: isIntegrationLoading } = useGetInboundIntegration(integrationId);
  const versions = integration?.versions || [];
  const deliveries = integration?.deliveries || [];
  const latestVersion = versions[0];

  const [activeTab, setActiveTab] = useState("mapping");
  const [sampleJson, setSampleJson] = useState("");
  const [analyzedPaths, setAnalyzedPaths] = useState<AnalyzedPath[]>([]);
  const [parsedSample, setParsedSample] = useState<any>(null);
  const [steps, setSteps] = useState<InboundStep[]>([]);
  const [dryRunResult, setDryRunResult] = useState<InboundDryRunResult | null>(null);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<number | null>(null);

  const { data: entities = [] } = useListEntities();
  const { data: pages = [] } = useListPages();
  const { data: roles = [] } = useListRoles();

  const analyzeMutation = useAnalyzeInboundSample({
    mutation: {
      onSuccess: (res) => {
        setAnalyzedPaths(res.paths || []);
        try {
          setParsedSample(JSON.parse(sampleJson));
          toast({ title: t("inbound.analyzed", "Структура проанализирована") });
        } catch {
          // ignore
        }
      },
      onError: () => toast({ title: t("inbound.analyzeError", "Ошибка анализа JSON"), variant: "destructive" })
    }
  });

  const saveDraftMutation = useCreateInboundMappingDraft({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: [`/api/inbound-integrations/${integrationId}`] });
        return res; // Pass back to chain
      },
      onError: (err: any) => toast({ title: t("inbound.draftError", "Ошибка сохранения"), description: err?.response?.data?.details?.join("\n"), variant: "destructive" })
    }
  });

  const publishMutation = usePublishInboundMapping({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/inbound-integrations/${integrationId}`] });
        toast({ title: t("inbound.published", "Маппинг опубликован") });
      },
      onError: () => toast({ title: t("inbound.publishError", "Ошибка публикации"), variant: "destructive" })
    }
  });

  const dryRunMutation = useDryRunInboundMapping({
    mutation: {
      onSuccess: (res: any) => {
        setDryRunResult(res);
        toast({ title: t("inbound.dryRunSuccess", "Тест успешно выполнен (отменен)") });
      },
      onError: (err: any) => {
        setDryRunResult(null);
        toast({ title: t("inbound.dryRunError", "Тест завершился с ошибкой"), variant: "destructive" });
      }
    }
  });

  // Init steps
  useEffect(() => {
    if (latestVersion?.mappingJson?.steps && steps.length === 0) {
      setSteps(latestVersion.mappingJson.steps.map((s: any) => {
        // Hydrate _uiEntityId for users
        if (s.target?.kind === "user" && !s._uiEntityId) {
           return { ...s, _uiEntityId: undefined }; // Will need to be picked by user or we just leave undefined
        }
        return s;
      }));
    }
  }, [latestVersion]);

  const handleAnalyze = () => {
    if (!sampleJson.trim()) return;
    try {
      const parsed = JSON.parse(sampleJson);
      analyzeMutation.mutate({ data: parsed });
    } catch (e) {
      toast({ title: t("inbound.invalidJson", "Невалидный JSON"), variant: "destructive" });
    }
  };

  const addStep = () => {
    const key = `step_${steps.length + 1}`;
    setSteps([...steps, {
      key,
      target: { kind: "entity", entityId: (entities[0] as any)?.id || 0 },
      operation: "upsert",
      matches: [{ kind: "fields", conditions: [] }],
      values: {}
    }]);
  };

  const handleDryRun = async () => {
    if (!parsedSample) {
      toast({ title: t("inbound.analyzeFirst", "Сначала добавьте и проанализируйте JSON"), variant: "destructive" });
      return;
    }
    try {
      const draft = await saveDraftMutation.mutateAsync({ id: integrationId, data: { atomic: true, steps } as any });
      await dryRunMutation.mutateAsync({ id: integrationId, data: { mappingVersionId: (draft as any).id, sample: parsedSample } as any });
    } catch (e) {
      // Error handled in mutations
    }
  };

  const handlePublish = async () => {
    try {
      const draft = await saveDraftMutation.mutateAsync({ id: integrationId, data: { atomic: true, steps } as any });
      publishMutation.mutate({ id: integrationId, versionId: (draft as any).id } as any);
    } catch (e) {
      // Error handled
    }
  };

  if (isIntegrationLoading) {
    return <div className="p-8 flex justify-center"><Skeleton className="h-32 w-full max-w-4xl" /></div>;
  }
  if (!integration) return null;

  const webhookUrl = `${window.location.origin}/api/webhooks/inbound/${integrationId}`;

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] lg:h-[100dvh] bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/admin/inbound-integrations")}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex flex-col">
            <h1 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              {integration.name}
              {integration.publishedMappingVersionId === latestVersion?.id ? (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 h-5">{t("inbound.publishedStatus", "Опубликовано")}</Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 h-5">{t("inbound.hasDraft", "Есть черновик")}</Badge>
              )}
            </h1>
            <span className="text-xs text-slate-500">
              {t("inbound.lastModified", "Последнее изменение")}: {latestVersion ? new Date(latestVersion.createdAt).toLocaleString() : "—"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            saveDraftMutation.mutate(
              { id: integrationId, data: { atomic: true, steps } as any },
              { onSuccess: () => toast({ title: t("inbound.draftSaved", "Черновик сохранён") }) },
            );
          }} disabled={saveDraftMutation.isPending}>
            <Save className="w-4 h-4 me-1.5" />
            {t("inbound.saveDraft", "Сохранить черновик")}
          </Button>
          <Button size="sm" variant="secondary" onClick={handleDryRun} disabled={dryRunMutation.isPending || saveDraftMutation.isPending}>
            <Play className="w-4 h-4 me-1.5" />
            {t("inbound.dryRun", "Тест (Dry Run)")}
          </Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={handlePublish} disabled={publishMutation.isPending || saveDraftMutation.isPending}>
            <CheckCircle2 className="w-4 h-4 me-1.5" />
            {t("inbound.publish", "Опубликовать")}
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <div className="px-6 pt-3 bg-white border-b border-slate-200 shrink-0">
          <TabsList>
            <TabsTrigger value="mapping">{t("inbound.mappingFlow", "Поток настройки")}</TabsTrigger>
            <TabsTrigger value="log">{t("inbound.deliveryLog", "Журнал доставок")}</TabsTrigger>
          </TabsList>
        </div>
        
        <TabsContent value="mapping" className="flex-1 overflow-y-auto m-0 p-4 lg:p-6 bg-slate-50 border-none outline-none">
          <div className="max-w-6xl mx-auto flex flex-col lg:flex-row gap-6 items-start">
            
            {/* Left Column: Connection & Data */}
            <div className="w-full lg:w-[400px] flex-shrink-0 flex flex-col gap-4">
              
              <Card className="border-slate-200 shadow-sm">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 bg-slate-50/50">
                  <Webhook className="w-4 h-4 text-purple-500" />
                  <h2 className="text-sm font-semibold text-slate-800">{t("inbound.connection", "1. Подключение")}</h2>
                </div>
                <div className="p-4 space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">{t("inbound.webhookUrl", "Webhook URL")}</Label>
                    <div className="flex gap-2">
                      <Input readOnly value={webhookUrl} className="h-8 text-xs font-mono bg-slate-50" />
                      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => {
                        navigator.clipboard.writeText(webhookUrl);
                        toast({ title: t("inbound.urlCopied", "URL скопирован") });
                      }}>
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">{t("inbound.authorization", "Авторизация")}</Label>
                    <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded border font-mono">
                      {t("inbound.header", "Заголовок")}: <span className="font-semibold">Authorization</span><br/>
                      {t("inbound.value", "Значение")}: <span className="font-semibold text-emerald-600">Bearer {integration.tokenPrefix}***</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-slate-500">{t("inbound.eventId", "ID события")}</Label>
                    <div className="text-xs text-slate-600 bg-slate-50 p-2 rounded border font-mono">
                      {t("inbound.header", "Заголовок")}: <span className="font-semibold">X-Event-Id</span> ({t("inbound.required", "Обязательно")})
                    </div>
                  </div>
                </div>
              </Card>

              <Card className="border-slate-200 shadow-sm flex flex-col flex-1">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                  <div className="flex items-center gap-2">
                    <FileJson className="w-4 h-4 text-blue-500" />
                    <h2 className="text-sm font-semibold text-slate-800">{t("inbound.jsonExample", "2. Пример JSON")}</h2>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAnalyze} disabled={analyzeMutation.isPending || !sampleJson.trim()}>
                    {t("inbound.analyze", "Анализ")}
                  </Button>
                </div>
                <div className="p-4 flex flex-col gap-4 flex-1">
                  <Textarea 
                    value={sampleJson}
                    onChange={e => setSampleJson(e.target.value)}
                    className="font-mono text-xs h-32 resize-y bg-slate-50"
                    placeholder={`{\n  "customer": {\n    "email": "user@example.com"\n  }\n}`}
                  />
                  
                  {parsedSample ? (
                    <div className="flex-1 overflow-y-auto max-h-[400px] rounded border border-slate-200 bg-white">
                      <JsonTree data={parsedSample} />
                    </div>
                  ) : (
                    <div className="text-center text-xs text-slate-400 py-8 border border-dashed rounded-md bg-slate-50">
                      {t("inbound.pasteAndAnalyze", "Вставьте JSON и нажмите «Анализ»")}
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* Right Column: Mapping */}
            <div className="flex-1 w-full space-y-4">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                  <List className="w-5 h-5 text-slate-400" />
                  {t("inbound.processingRules", "3. Правила обработки (Шаги)")}
                </h2>
                <Button size="sm" variant="outline" onClick={addStep}>
                  <Plus className="w-4 h-4 me-1.5" /> {t("inbound.addStep", "Добавить шаг")}
                </Button>
              </div>
              
              {dryRunResult && (
                <Card className={`border ${dryRunResult.delivery.status === "failed" ? 'border-red-300 bg-red-50' : 'border-emerald-300 bg-emerald-50'} shadow-sm`}>
                  <div className="p-4">
                    <h3 className={`text-sm font-semibold mb-2 ${dryRunResult.delivery.status === "failed" ? 'text-red-800' : 'text-emerald-800'}`}>
                      {t("inbound.dryRunResult", "Результат тестирования (Dry Run)")}
                    </h3>
                    {dryRunResult.delivery.errorMessage && dryRunResult.delivery.status === "failed" && (
                      <p className="text-xs font-mono text-red-600 mb-2">{dryRunResult.delivery.errorMessage}</p>
                    )}
                    {dryRunResult.steps.length > 0 && (
                      <div className="space-y-1 text-xs text-slate-700">
                        {dryRunResult.steps.map((step) => (
                          <div key={step.id} className="flex items-center gap-2 rounded bg-white/60 px-2 py-1.5">
                            {step.status === "completed" ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <AlertTriangle className="h-3.5 w-3.5 text-red-600" />}
                            <span className="font-mono">{step.stepKey}</span>
                            <span className="text-slate-500">{step.message ?? step.action ?? step.status}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {dryRunResult.delivery.status !== "failed" && (
                      <p className="text-xs text-emerald-700">{t("inbound.changesSimulated", "Изменения успешно сымитированы и отменены.")}</p>
                    )}
                  </div>
                </Card>
              )}

              {steps.length === 0 ? (
                <div className="text-center bg-white py-16 rounded-lg border border-dashed border-slate-300 shadow-sm">
                  <LayoutTemplate className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-sm font-medium text-slate-700 mb-1">{t("inbound.noMappingSteps", "Нет шагов маппинга")}</h3>
                  <p className="text-xs text-slate-500 mb-5 max-w-sm mx-auto">{t("inbound.noMappingStepsHint", "Добавьте шаги для создания или обновления записей на основе входящего JSON.")}</p>
                  <Button onClick={addStep}>{t("inbound.createFirstStep", "Создать первый шаг")}</Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {steps.map((step, idx) => (
                    <StepCard 
                      key={step.key || idx} 
                      step={step} 
                      idx={idx}
                      steps={steps}
                      entities={entities as any[]}
                      roles={roles as any[]}
                      pages={pages as any[]}
                      analyzedPaths={analyzedPaths}
                      onChange={(newStep: any) => {
                        const newSteps = [...steps];
                        newSteps[idx] = newStep;
                        setSteps(newSteps);
                      }}
                      onRemove={() => {
                        const newSteps = [...steps];
                        newSteps.splice(idx, 1);
                        setSteps(newSteps);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="log" className="flex-1 overflow-y-auto m-0 p-4 lg:p-6 bg-slate-50 border-none outline-none">
          <div className="max-w-4xl mx-auto space-y-4">
            <h2 className="text-lg font-semibold text-slate-800">{t("inbound.deliveryLog", "Журнал доставок")}</h2>
            {deliveries.length === 0 ? (
              <div className="text-center bg-white py-12 rounded-lg border border-dashed border-slate-300">
                <h3 className="text-sm font-medium text-slate-700 mb-1">{t("inbound.noDeliveries", "Нет доставок")}</h3>
                <p className="text-xs text-slate-500">{t("inbound.noDeliveriesHint", "Отправьте данные на webhook-адрес интеграции, чтобы они появились здесь.")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {deliveries.map((delivery: any) => (
                  <Card key={delivery.id} className="border-slate-200 shadow-sm overflow-hidden cursor-pointer hover:border-slate-300 transition-colors" onClick={() => setSelectedDeliveryId(delivery.id)}>
                    <div className="px-4 py-3 bg-white flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant={delivery.status === "completed" ? "default" : delivery.status === "failed" ? "destructive" : "secondary"} className={delivery.status === "completed" ? "bg-emerald-500" : ""}>
                          {delivery.status}
                        </Badge>
                        <span className="text-xs text-slate-500">{new Date(delivery.receivedAt).toLocaleString()}</span>
                         <span className="text-xs font-mono text-slate-400">ID: {delivery.id}</span>
                         {delivery.eventId && <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{t("inbound.event", "Событие")}: {delivery.eventId}</span>}
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                    {delivery.errorMessage && (
                      <div className="px-4 py-2 bg-red-50 border-t border-red-100 text-xs text-red-700 font-mono truncate">
                        {delivery.errorMessage}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
      
      {/* Delivery Details Dialog */}
      <DeliveryDetailsDialog 
        deliveryId={selectedDeliveryId} 
        onClose={() => setSelectedDeliveryId(null)} 
      />
    </div>
  );
}

function DeliveryDetailsDialog({ deliveryId, onClose }: { deliveryId: number | null, onClose: () => void }) {
  const t = useT();
  const queryId = deliveryId ?? 0;
  const { data: delivery, isLoading } = useGetInboundDelivery(queryId, {
    query: { enabled: !!deliveryId, queryKey: getGetInboundDeliveryQueryKey(queryId) },
  });
  const reprocess = useReprocessInboundDelivery();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleReprocess = () => {
    if (!deliveryId) return;
    reprocess.mutate({ id: deliveryId }, {
      onSuccess: () => {
        toast({ title: t("inbound.reprocessStarted", "Переобработка запущена") });
        queryClient.invalidateQueries({ queryKey: [`/api/inbound-deliveries/${deliveryId}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/inbound-integrations`] }); // rough invalidate
      },
      onError: () => toast({ title: t("inbound.reprocessError", "Ошибка переобработки"), variant: "destructive" })
    });
  };

  return (
    <Dialog open={!!deliveryId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0">
        {isLoading ? (
          <div className="p-8 flex justify-center"><Skeleton className="h-32 w-full" /></div>
        ) : !delivery ? (
          <div className="p-8 text-center text-slate-500">{t("inbound.notFound", "Не найдено")}</div>
        ) : (
          <>
            <DialogHeader className="p-4 pb-2 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <DialogTitle className="flex items-center gap-2">
                  {t("inbound.delivery", "Доставка")} #{delivery.id}
                  <Badge variant={delivery.status === "completed" ? "default" : delivery.status === "failed" ? "destructive" : "secondary"}>
                    {delivery.status}
                  </Badge>
                </DialogTitle>
                <div className="text-xs text-slate-500">
                  {t("inbound.attempts", "Попыток")}: {delivery.attemptCount}
                </div>
              </div>
              <DialogDescription className="text-xs flex gap-4 mt-2">
                <span>{new Date(delivery.receivedAt).toLocaleString()}</span>
                 {delivery.eventId && <span className="font-mono bg-slate-100 px-1 rounded text-slate-600">{t("inbound.event", "Событие")}: {delivery.eventId}</span>}
              </DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {delivery.errorMessage && (
                <div className="bg-red-50 text-red-700 p-3 rounded text-xs font-mono border border-red-200 whitespace-pre-wrap">
                  {delivery.errorMessage}
                </div>
              )}
              <div>
                <h4 className="text-sm font-medium mb-2">{t("inbound.stepExecutionLog", "Лог выполнения шагов")}</h4>
                <div className="bg-slate-900 text-slate-200 rounded p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                  {delivery.steps.length > 0 ? delivery.steps.map((step) => (
                    <div key={step.id} className="mb-2 last:mb-0">
                      <span className={step.status === "completed" ? "text-emerald-300" : "text-red-300"}>{step.status}</span>
                      {" · "}{step.stepKey}{step.action ? ` · ${step.action}` : ""}{step.targetId ? ` · #${step.targetId}` : ""}
                      {step.message ? <div className="text-slate-400">{step.message}</div> : null}
                    </div>
                  )) : t("inbound.noLogs", "Нет логов")}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium mb-2">{t("inbound.incomingPayload", "Входящий payload")}</h4>
                <div className="bg-slate-900 text-slate-200 rounded p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                   {delivery.payloadJson !== undefined ? JSON.stringify(delivery.payloadJson, null, 2) : t("inbound.noData", "Нет данных")}
                </div>
              </div>
            </div>
            <DialogFooter className="p-4 border-t border-slate-100 bg-slate-50">
              <Button variant="outline" onClick={onClose}>{t("inbound.close", "Закрыть")}</Button>
              <Button onClick={handleReprocess} disabled={reprocess.isPending}>{t("inbound.reprocess", "Переобработать")}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StepCard({ step, idx, steps, entities, roles, pages, analyzedPaths, onChange, onRemove }: any) {
  const [expanded, setExpanded] = useState(true);
  const ml = useML();
  const t = useT();

  const isUserTarget = step.target?.kind === "user";
  const isPageTarget = step.target?.kind === "page";
  const uiEntityId = isUserTarget ? step._uiEntityId : step.target?.entityId;

  const queryEntityId = uiEntityId ?? 0;
  const { data: rawFields = [] } = useListEntityFields(queryEntityId, {
    query: { enabled: !!uiEntityId, queryKey: getListEntityFieldsQueryKey(queryEntityId) },
  });
  const { data: relations = [] } = useListEntityRelations(queryEntityId, {
    query: { enabled: !!uiEntityId && !isUserTarget && !isPageTarget, queryKey: getListEntityRelationsQueryKey(queryEntityId) },
  });
  const queryPageId = isPageTarget ? (step.target.pageId ?? 0) : 0;
  const { data: pageFields = [] } = useListPageFields(queryPageId, {
    query: { enabled: isPageTarget && queryPageId > 0, queryKey: getListPageFieldsQueryKey(queryPageId) },
  });
  const entityFields = rawFields as any[];

  const update = (patch: any) => onChange({ ...step, ...patch });

  const entity = entities.find((e: any) => e.id === uiEntityId);
  const selectedPage = pages.find((page: any) => page.id === step.target?.pageId);
  const operationTitle = step.operation === "upsert" ? t("inbound.operationUpsertShort", "Создать/обновить") : step.operation === "create" ? t("inbound.operationCreateShort", "Создать") : step.operation === "update" ? t("inbound.operationUpdateShort", "Обновить") : t("inbound.operationFindShort", "Найти");
  const targetTitle = isUserTarget ? t("inbound.user", "Пользователя") : isPageTarget ? `${t("inbound.pageFields", "поля страницы")} ${selectedPage ? ml(selectedPage.nameJson) : ""}` : entity ? ml(entity.nameJson) : t("inbound.record", "Запись");
  const title = `${t("inbound.step", "Шаг")} ${idx + 1}: ${operationTitle} ${targetTitle}`;

  const priorSteps = steps.slice(0, idx);

  // Auto-set first entity for User if none
  useEffect(() => {
    if (isUserTarget && !uiEntityId && entities.length > 0) {
      update({ _uiEntityId: entities[0].id });
    }
  }, [isUserTarget, uiEntityId, entities]);

  return (
    <Card className="border-slate-200 shadow-sm overflow-hidden bg-white transition-all">
      <div 
        className={`px-4 py-3 border-b flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors ${expanded ? 'bg-slate-50/50 border-slate-200' : 'border-transparent'}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
          <Badge variant="outline" className="h-5 bg-white text-slate-500 font-mono font-normal">{step.key}</Badge>
          <h3 className="text-sm font-medium text-slate-800">{title}</h3>
          {step.source && <span className="text-xs text-slate-400 font-mono">← {step.source}</span>}
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 hover:bg-red-50" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Trash2 className="w-4 h-4" />
        </Button>
      </div>
      
      {expanded && (
        <div className="p-5 space-y-6">
          {/* Top basic settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">{t("inbound.stepKey", "Уникальный ключ шага")}</Label>
              <Input value={step.key} onChange={e => update({ key: e.target.value })} className="h-8 text-xs font-mono" />
            </div>
            
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">{t("inbound.operation", "Операция")}</Label>
              <Select value={step.operation} onValueChange={v => update({ operation: v })}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="upsert">{t("inbound.operationUpsert", "Найти или создать (Upsert)")}</SelectItem>
                  <SelectItem value="create">{t("inbound.operationCreate", "Только создать")}</SelectItem>
                  <SelectItem value="update">{t("inbound.operationUpdate", "Только обновить")}</SelectItem>
                  <SelectItem value="find">{t("inbound.operationFind", "Только найти")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
               <Label className="text-xs text-slate-500">{t("inbound.resultType", "Тип результата")}</Label>
               <Select value={isUserTarget ? "user" : isPageTarget ? "page" : "entity"} onValueChange={v => {
                if (v === "user") {
                  update({ target: { kind: "user", fieldId: 0, roleId: 0 }, _uiEntityId: entities[0]?.id });
                 } else if (v === "page") {
                   const page = pages.find((item: any) => (item.entityId ?? item.mirrorEntityId) != null);
                   update({ target: { kind: "page", pageId: page?.id ?? 0, entityId: page?.entityId ?? page?.mirrorEntityId ?? 0 }, operation: "update", _uiEntityId: undefined });
                } else {
                  update({ target: { kind: "entity", entityId: entities[0]?.id || 0 }, _uiEntityId: undefined });
                }
              }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="entity">{t("inbound.entityRecord", "Запись сущности")}</SelectItem>
                   <SelectItem value="page">{t("inbound.localPageFields", "Локальные поля страницы")}</SelectItem>
                  <SelectItem value="user">{t("inbound.platformUser", "Пользователь платформы")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

             {isUserTarget ? (
              <div className="space-y-1.5">
                 <Label className="text-xs text-slate-500">{t("inbound.profileEntity", "Сущность профиля")}</Label>
                <Select value={String(uiEntityId || "")} onValueChange={v => update({ _uiEntityId: Number(v), target: { ...step.target, fieldId: 0 } })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {entities.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{ml(e.nameJson)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
             ) : isPageTarget ? (
               <div className="space-y-1.5">
                  <Label className="text-xs text-slate-500">{t("inbound.page", "Страница")}</Label>
                 <Select value={String(step.target.pageId || "")} onValueChange={value => {
                   const page = pages.find((item: any) => item.id === Number(value));
                   update({ target: { kind: "page", pageId: Number(value), entityId: page?.entityId ?? page?.mirrorEntityId ?? 0 }, operation: "update" });
                 }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("inbound.selectPage", "Выберите страницу")} /></SelectTrigger>
                   <SelectContent>
                     {pages.filter((page: any) => (page.entityId ?? page.mirrorEntityId) != null).map((page: any) => (
                       <SelectItem key={page.id} value={String(page.id)}>{ml(page.nameJson)}</SelectItem>
                     ))}
                   </SelectContent>
                 </Select>
               </div>
             ) : (
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500">{t("inbound.targetEntity", "Целевая сущность")}</Label>
                <Select value={String(uiEntityId || "")} onValueChange={v => update({ target: { ...step.target, entityId: Number(v) } })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {entities.map((e: any) => <SelectItem key={e.id} value={String(e.id)}>{ml(e.nameJson)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5 md:col-span-2 lg:col-span-4">
               <Label className="text-xs text-slate-500">{t("inbound.arrayRoot", "Корень для массивов (опционально, путь JSON)")}</Label>
              <Input 
                value={step.source || ""} 
                onChange={e => update({ source: e.target.value })} 
                placeholder={t("inbound.arrayRootPlaceholder", "Например: data.items. Обрабатывать каждый элемент массива.")} 
                className="h-8 text-xs font-mono bg-slate-50" 
              />
            </div>
          </div>
           {!isUserTarget && ["upsert", "update"].includes(step.operation) && (
             <label className="flex items-center gap-2 text-xs text-slate-600">
               <Checkbox checked={step.updateOnMatch !== false} onCheckedChange={(checked) => update({ updateOnMatch: checked === true })} />
               {t("inbound.updateOnMatch", "Обновлять найденную запись")}
             </label>
           )}

           {!isUserTarget && !isPageTarget && step.target?.kind === "entity" && (
             <div className="border border-blue-100 bg-blue-50/40 rounded-md p-3 space-y-3">
               <div>
                 <h4 className="text-xs font-semibold text-blue-800">{t("inbound.fileMappings", "Файлы Google Drive")}</h4>
                 <p className="text-xs text-slate-500 mt-1">{t("inbound.fileMappingsHint", "Выберите file-поле, путь к массиву файлов и точный file_tag. Папка и шаблон имени берутся только из настроек поля.")}</p>
               </div>
               {(step.files || []).map((file: any, fi: number) => (
                 <div key={fi} className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                   <Select value={file.fieldKey} onValueChange={(fieldKey) => { const files = [...(step.files || [])]; files[fi] = { ...files[fi], fieldKey }; update({ files }); }}>
                     <SelectTrigger className="h-8 text-xs bg-white"><SelectValue placeholder={t("inbound.targetFileField", "Целевое file-поле")} /></SelectTrigger>
                     <SelectContent>{entityFields.filter(f => f.isActive && f.fieldType === "file").map(f => <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)} ({f.fieldKey})</SelectItem>)}</SelectContent>
                   </Select>
                   <Input value={file.source} onChange={e => { const files = [...(step.files || [])]; files[fi] = { ...files[fi], source: e.target.value }; update({ files }); }} placeholder="files" className="h-8 text-xs font-mono bg-white" />
                   <Input value={file.tag} onChange={e => { const files = [...(step.files || [])]; files[fi] = { ...files[fi], tag: e.target.value }; update({ files }); }} placeholder="file_tag" className="h-8 text-xs font-mono bg-white" />
                   <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-500" onClick={() => { const files = [...(step.files || [])]; files.splice(fi, 1); update({ files }); }}><X className="w-3.5 h-3.5" /></Button>
                 </div>
               ))}
               <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => update({ files: [...(step.files || []), { fieldKey: "", source: "", tag: "" }] })}><Plus className="w-3.5 h-3.5 me-1" />{t("inbound.addFileMapping", "Добавить файл")}</Button>
             </div>
           )}

          {/* User Specific Settings */}
          {isUserTarget && (
            <div className="bg-purple-50/50 border border-purple-100 p-4 rounded-md space-y-4">
              <h4 className="text-xs font-semibold text-purple-700 uppercase tracking-wide flex items-center gap-1.5">
                {t("inbound.userProfileSettings", "Настройки профиля пользователя")}
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">{t("inbound.userLinkField", "Поле связи с пользователем")}</Label>
                  <Select value={String(step.target?.fieldId || "")} onValueChange={v => update({ target: { ...step.target, fieldId: Number(v) } })}>
                    <SelectTrigger className="h-8 text-xs bg-white"><SelectValue placeholder={t("inbound.selectUserField", "Выберите поле (user)")} /></SelectTrigger>
                    <SelectContent>
                       {entityFields.filter(f => f.isActive && f.fieldType === "user").map(f => (
                          <SelectItem key={f.id} value={String(f.id)}>{ml(f.nameJson)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500">
                    {t("inbound.userFieldCreationAvailability", "All active user fields can find users. Creating a new user is available only when the selected field allows creation.")}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">{t("inbound.defaultRole", "Роль по умолчанию (фиксированная)")}</Label>
                  <Select value={String(step.target?.roleId || "")} onValueChange={v => update({ target: { ...step.target, roleId: Number(v) } })}>
                    <SelectTrigger className="h-8 text-xs bg-white"><SelectValue placeholder={t("inbound.selectRole", "Выберите роль")} /></SelectTrigger>
                    <SelectContent>
                      {roles.map((r: any) => (
                         <SelectItem key={r.id} value={String(r.id)}>{ml(r.nameJson)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {/* Matches */}
          {["upsert", "update", "find"].includes(step.operation) && (
            <div>
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-blue-500" />
                {t("inbound.matchStrategy", "Стратегия поиска (Match)")}
              </h4>
              <div className="space-y-3">
                {(step.matches || []).map((match: any, mi: number) => (
                  <div key={mi} className="border border-slate-200 rounded-md p-3 bg-slate-50">
                    <div className="flex items-center gap-3 mb-3">
                      <Select value={match.kind} onValueChange={v => {
                        const m = [...step.matches];
                        m[mi] = { kind: v as any, conditions: v === "fields" ? [{ fieldKey: "", value: { operand: { kind: "source", path: "" } } }] : undefined };
                        update({ matches: m });
                      }}>
                        <SelectTrigger className="h-8 text-xs w-48 bg-white"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="system_id">{t("inbound.matchSystemId", "По внутреннему ID")}</SelectItem>
                          <SelectItem value="external">{t("inbound.matchExternal", "По внешнему ID (External)")}</SelectItem>
                          <SelectItem value="fields">{t("inbound.matchFields", "По совпадению полей")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-400 hover:text-red-500 ms-auto" onClick={() => {
                        const m = [...step.matches]; m.splice(mi, 1); update({ matches: m });
                      }}>
                        {t("inbound.delete", "Удалить")}
                      </Button>
                    </div>

                    {match.kind === "system_id" && (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_12rem_12rem]">
                         <div className="space-y-1.5 flex-1">
                           <Label className="text-xs text-slate-500">{t("inbound.idValue", "Значение ID")}</Label>
                           <OperandSelector 
                             value={match.value || { operand: { kind: "source", path: "" } }} 
                             onChange={v => { const m = [...step.matches]; m[mi].value = v; update({ matches: m }); }}
                             priorSteps={priorSteps}
                             analyzedPaths={analyzedPaths}
                             stepSource={step.source}
                           />
                         </div>
                          <div className="space-y-1.5 mt-5">
                           <div className="flex items-center gap-2">
                             <Checkbox 
                               checked={match.onMissingExplicitId === "continue"} 
                               onCheckedChange={c => { const m = [...step.matches]; m[mi].onMissingExplicitId = c ? "continue" : "error"; update({ matches: m }); }}
                             />
                              <Label className="text-xs">{t("inbound.continueIfMissing", "Продолжить при отсутствии")}</Label>
                           </div>
                         </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs text-slate-500">{t("inbound.maxValueExclusive", "Пропускать ID от (не включительно)")}</Label>
                            <Input
                              type="number"
                              min="1"
                              step="1"
                              value={match.maxValueExclusive ?? ""}
                              onChange={event => {
                                const matches = [...step.matches];
                                const value = event.target.value;
                                if (value === "") delete matches[mi].maxValueExclusive;
                                else matches[mi].maxValueExclusive = Number(value);
                                update({ matches });
                              }}
                              className="h-8 text-xs bg-white"
                              placeholder={t("inbound.noMaximum", "Без ограничения")}
                            />
                            <p className="text-xs text-slate-500">{t("inbound.maxValueExclusiveHint", "При этом ID или больше стратегия пропускается.")}</p>
                          </div>
                      </div>
                    )}

                    {match.kind === "external" && (
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[180px_1fr]">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-500">{t("inbound.externalObjectType", "Тип объекта во внешней системе")}</Label>
                          <Input value={match.objectType ?? ""} onChange={event => {
                            const matches = [...step.matches];
                            matches[mi].objectType = event.target.value;
                            update({ matches });
                          }} className="h-8 text-xs" placeholder="customer, order…" />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-slate-500">{t("inbound.externalId", "Внешний ID")}</Label>
                          <OperandSelector
                            value={match.value || { operand: { kind: "source", path: "" } }}
                            onChange={value => {
                              const matches = [...step.matches];
                              matches[mi].value = value;
                              update({ matches });
                            }}
                            priorSteps={priorSteps}
                            analyzedPaths={analyzedPaths}
                            stepSource={step.source}
                          />
                        </div>
                      </div>
                    )}

                    {match.kind === "fields" && (
                      <div className="space-y-2">
                        {(match.conditions || []).map((cond: any, ci: number) => (
                          <div key={ci} className="flex items-start gap-2 bg-white p-2 rounded border border-slate-100">
                            <div className="w-1/3">
                              <Select value={cond.fieldKey} onValueChange={v => {
                                const m = [...step.matches]; m[mi].conditions[ci].fieldKey = v; update({ matches: m });
                              }}>
                                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("inbound.searchField", "Поле для поиска")} /></SelectTrigger>
                                <SelectContent>
                                  {isUserTarget && (
                                    <>
                                      <SelectItem value="email">Email</SelectItem>
                                      <SelectItem value="firstName">{t("inbound.firstName", "Имя (firstName)")}</SelectItem>
                                      <SelectItem value="lastName">{t("inbound.lastName", "Фамилия (lastName)")}</SelectItem>
                                    </>
                                  )}
                                  {!isUserTarget && entityFields.filter(f => f.isActive).map(f => (
                                    <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="flex items-center text-xs text-slate-400 h-8 px-1">=</div>
                            <div className="flex-1">
                              <OperandSelector 
                                value={cond.value || { operand: { kind: "source", path: "" } }} 
                                onChange={v => { const m = [...step.matches]; m[mi].conditions[ci].value = v; update({ matches: m }); }}
                                priorSteps={priorSteps}
                                analyzedPaths={analyzedPaths}
                                stepSource={step.source}
                              />
                            </div>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400" onClick={() => {
                               const m = [...step.matches]; m[mi].conditions.splice(ci, 1); update({ matches: m });
                            }}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        ))}
                        <Button variant="outline" size="sm" className="h-7 text-xs bg-white" onClick={() => {
                          const m = [...step.matches];
                          m[mi].conditions = [...(m[mi].conditions || []), { fieldKey: "", value: { operand: { kind: "source", path: "" } } }];
                          update({ matches: m });
                        }}>
                          <Plus className="w-3 h-3 me-1" /> {t("inbound.addAndCondition", "Добавить AND условие")}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
                  update({ matches: [...(step.matches || []), { kind: "fields", conditions: [{ fieldKey: "", value: { operand: { kind: "source", path: "" } } }] }] });
                }}>
                  <Plus className="w-3 h-3 me-1" /> {t("inbound.addMatchStrategy", "Добавить стратегию поиска")}
                </Button>
              </div>
            </div>
          )}

          {/* Hierarchy Links */}
          {["create", "upsert", "update"].includes(step.operation) && !isUserTarget && !isPageTarget && (
            <div>
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <LinkIcon className="w-3.5 h-3.5 text-emerald-500" />
                {t("inbound.previousStepLinks", "Связи с предыдущими шагами")}
              </h4>
              <div className="space-y-2">
                {(step.links || []).map((link: any, li: number) => (
                  <div key={li} className="flex items-center gap-2">
                    <Select value={String(link.relationId)} onValueChange={v => {
                       const l = [...step.links]; l[li].relationId = Number(v); update({ links: l });
                    }}>
                      <SelectTrigger className="h-8 text-xs w-48"><SelectValue placeholder={t("inbound.relation", "Связь (Relation)")} /></SelectTrigger>
                      <SelectContent>
                        {relations.map((relation: any) => (
                           <SelectItem key={relation.id} value={String(relation.id)}>{ml(relation.nameJson)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-slate-400">→</span>
                    <Select value={link.toStep} onValueChange={v => {
                       const l = [...step.links]; l[li].toStep = v; update({ links: l });
                    }}>
                      <SelectTrigger className="h-8 text-xs w-48"><SelectValue placeholder={t("inbound.step", "Шаг")} /></SelectTrigger>
                      <SelectContent>
                        {priorSteps.filter((ps: any) => {
                          const relation = relations.find((r: any) => r.id === link.relationId);
                          return ps.target?.kind === "entity" && (!relation || ps.target.entityId === relation.targetEntityId);
                        }).map((ps: any) => (
                          <SelectItem key={ps.key} value={ps.key}>{ps.key}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400" onClick={() => {
                       const l = [...step.links]; l.splice(li, 1); update({ links: l });
                    }}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
                  update({ links: [...(step.links || []), { relationId: 0, toStep: "" }] });
                }}>
                  <Plus className="w-3 h-3 me-1" /> {t("inbound.linkToStep", "Привязать к шагу")}
                </Button>
              </div>
            </div>
          )}

          {/* Fields Mapping */}
          {["create", "upsert", "update"].includes(step.operation) && (
            <div>
              <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                <BoxSelect className="w-3.5 h-3.5 text-amber-500" />
                {t("inbound.fieldMapping", "Маппинг полей (Значения)")}
              </h4>
              <div className="border border-slate-100 rounded-md p-3 space-y-2 bg-slate-50">
                 {Object.entries(step.values || {}).map(([key, val]: [string, any], vi: number) => (
                   <div key={vi} className="flex items-start gap-2 bg-white p-2 rounded border border-slate-100">
                     <div className="w-1/3">
                       <Select value={key} onValueChange={v => {
                         const newV = { ...step.values };
                         const old = newV[key];
                         delete newV[key];
                         newV[v] = old;
                         update({ values: newV });
                       }}>
                         <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t("inbound.selectField", "Выберите поле")} /></SelectTrigger>
                         <SelectContent>
                           {isUserTarget && (
                             <>
                               <SelectItem value="email">Email</SelectItem>
                                <SelectItem value="firstName">{t("inbound.firstName", "Имя (firstName)")}</SelectItem>
                                <SelectItem value="lastName">{t("inbound.lastName", "Фамилия (lastName)")}</SelectItem>
                             </>
                           )}
                            {!isUserTarget && !isPageTarget && entityFields.filter(f => f.isActive && !["relation", "lookup", "function", "created_at"].includes(f.fieldType)).map(f => (
                              <SelectItem key={f.fieldKey} value={f.fieldKey}>{ml(f.nameJson)}</SelectItem>
                           ))}
                            {isPageTarget && pageFields.filter((field: any) => field.isActive && !["relation", "lookup", "function", "created_at"].includes(field.fieldType)).map((field: any) => (
                              <SelectItem key={field.fieldKey} value={field.fieldKey}>{ml(field.nameJson)}</SelectItem>
                            ))}
                         </SelectContent>
                       </Select>
                     </div>
                     <div className="flex items-center text-xs text-slate-400 h-8 px-1">←</div>
                     <div className="flex-1">
                       <OperandSelector 
                         value={val} 
                         onChange={v => {
                           const newV = { ...step.values };
                           newV[key] = v;
                           update({ values: newV });
                         }}
                         priorSteps={priorSteps}
                          analyzedPaths={analyzedPaths}
                          stepSource={step.source}
                       />
                     </div>
                     <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-slate-400" onClick={() => {
                        const newV = { ...step.values };
                        delete newV[key];
                        update({ values: newV });
                     }}>
                       <X className="w-3.5 h-3.5" />
                     </Button>
                   </div>
                 ))}
                 
                 <Button variant="outline" size="sm" className="h-7 text-xs bg-white" onClick={() => {
                   let prefix = isUserTarget ? "email" : "new_field";
                   let n = 1;
                   while (step.values && step.values[`${prefix}_${n}`]) n++;
                   update({ values: { ...step.values, [`${prefix}_${n}`]: { operand: { kind: "source", path: "" } } } });
                 }}>
                    <Plus className="w-3 h-3 me-1" /> {t("inbound.addField", "Добавить поле")}
                 </Button>
              </div>
            </div>
          )}

        </div>
      )}
    </Card>
  );
}

function OperandSelector({ 
  value, 
  onChange, 
  priorSteps,
  analyzedPaths = [],
  stepSource = ""
}: { 
  value: any, 
  onChange: (v: any) => void, 
  priorSteps: any[],
  analyzedPaths?: AnalyzedPath[],
  stepSource?: string
}) {
  const t = useT();
  const kind = value?.operand?.kind || "source";
  const id = useId();
  
  // Filter paths for autocomplete
  const suggestedPaths = useMemo(() => {
    let prefix = stepSource ? (stepSource.endsWith("[0]") ? stepSource + "." : stepSource + "[0].") : "";
    
    return analyzedPaths
      .filter(p => !prefix || p.path.startsWith(prefix))
      .map(p => {
        let displayPath = p.path;
        if (prefix) displayPath = displayPath.slice(prefix.length);
        return { ...p, displayPath };
      })
      .filter(p => p.displayPath !== "" && p.displayPath !== "$");
  }, [analyzedPaths, stepSource]);

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex gap-2 w-full">
        <Select value={kind} onValueChange={v => {
          onChange({ ...value, operand: { kind: v as any, path: "", value: "", step: "" } });
        }}>
          <SelectTrigger className="h-8 text-xs w-[120px] shrink-0 bg-white"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="source">{t("inbound.jsonPath", "JSON путь")}</SelectItem>
            <SelectItem value="static">{t("inbound.staticValue", "Статика")}</SelectItem>
            <SelectItem value="result">{t("inbound.stepId", "ID шага")}</SelectItem>
          </SelectContent>
        </Select>

        {kind === "source" && (
          <div className="flex-1 relative">
            <Input 
              list={`paths-${id}`}
              value={value.operand.path || ""} 
              onChange={e => onChange({ ...value, operand: { ...value.operand, path: e.target.value } })} 
              className="h-8 text-xs w-full font-mono bg-white" 
              placeholder="path.to.value" 
            />
            <datalist id={`paths-${id}`}>
              {suggestedPaths.map(p => (
                <option key={p.displayPath} value={p.displayPath}>
                  {p.sample !== undefined ? `${t("inbound.example", "Пример")}: ${String(p.sample).slice(0, 30)}` : ""}
                </option>
              ))}
            </datalist>
          </div>
        )}
        {kind === "static" && (
          <Input 
            value={value.operand.value || ""} 
            onChange={e => onChange({ ...value, operand: { ...value.operand, value: e.target.value } })} 
            className="h-8 text-xs flex-1 bg-white" 
            placeholder={t("inbound.staticValuePlaceholder", "Текст, число...")} 
          />
        )}
        {kind === "result" && (
          <Select value={value.operand.step || ""} onValueChange={v => onChange({ ...value, operand: { ...value.operand, step: v } })}>
            <SelectTrigger className="h-8 text-xs flex-1 font-mono bg-white"><SelectValue placeholder={t("inbound.step", "Шаг")} /></SelectTrigger>
            <SelectContent>
              {priorSteps.map(ps => (
                <SelectItem key={ps.key} value={ps.key}>{ps.key}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className={`h-8 w-8 shrink-0 ${value.transforms?.length ? 'text-blue-600 bg-blue-50' : 'text-slate-400'}`}>
              <Settings2 className="w-4 h-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" align="end">
            <h4 className="text-xs font-semibold mb-2 text-slate-700">{t("inbound.transforms", "Трансформации (опционально)")}</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto pe-1">
              {[
                { id: "trim", label: t("inbound.transformTrim", "Trim (удалить пробелы)") },
                { id: "lower", label: t("inbound.transformLower", "В нижний регистр") },
                { id: "upper", label: t("inbound.transformUpper", "В верхний регистр") },
                { id: "normalize_email", label: t("inbound.transformEmail", "Нормализовать email") },
                { id: "normalize_phone", label: t("inbound.transformPhone", "Нормализовать телефон") },
                { id: "string", label: t("inbound.transformString", "Привести к строке") },
                { id: "number", label: t("inbound.transformNumber", "Привести к числу") },
                { id: "boolean", label: t("inbound.transformBoolean", "Привести к Boolean") },
                { id: "date", label: t("inbound.transformDate", "Привести к ISO дате") }
              ].map(transform => {
                const checked = (value.transforms || []).includes(transform.id);
                return (
                  <label key={transform.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox 
                      checked={checked} 
                      onCheckedChange={(c) => {
                        let newT = [...(value.transforms || [])];
                        if (c) newT.push(transform.id);
                        else newT = newT.filter(x => x !== transform.id);
                        onChange({ ...value, transforms: newT.length ? newT : undefined });
                      }}
                    />
                    {transform.label}
                  </label>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}