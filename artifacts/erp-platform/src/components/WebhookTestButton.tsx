import { useEffect, useRef, useState } from "react";
import { useTestEntityWebhook, type WebhookTestResult } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export function WebhookTestButton({ entityId, url, includeRecord, language }: {
  entityId: number; url: string; includeRecord: boolean; language: "ru" | "en" | "he";
}) {
  const t = useT();
  const mutation = useTestEntityWebhook({ mutation: { retry: false } });
  const [result, setResult] = useState<WebhookTestResult | null>(null);
  const busy = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setResult(null);
    return () => { generation.current++; };
  }, [entityId, url, includeRecord, language]);
  let valid = false;
  try { const u = new URL(url); valid = ["http:", "https:"].includes(u.protocol) && !u.username && !u.password; } catch { /* invalid draft */ }
  const run = async () => {
    if (busy.current || !valid) return;
    busy.current = true;
    setResult(null);
    const current = generation.current;
    try {
      const outcome = await mutation.mutateAsync({ entityId, data: { url, includeRecord, language } });
      if (current === generation.current) setResult(outcome);
    } catch {
      if (current === generation.current) setResult({ ok: false, error: "request_error" });
    } finally { busy.current = false; }
  };
  const errors: Record<string, string> = {
    invalid_url: t("auto.testInvalidUrl", "Нужен HTTP(S)-адрес вебхука, а не почтовый адрес."),
    blocked_address: t("auto.testBlocked", "Отправка на локальные и закрытые адреса запрещена."),
    timeout: t("auto.testTimeout", "Нет ответа за 5 секунд. Получатель мог принять запрос; проверьте его перед повтором."),
    network_error: t("auto.testNetwork", "Ошибка соединения. Проверьте получение перед повторной отправкой."),
    dns_error: t("auto.testDns", "Не удалось определить адрес сервера."),
    redirect_not_allowed: t("auto.testRedirect", "Получатель вернул перенаправление. Укажите конечный адрес вебхука."),
    http_error: t("auto.testHttp", "Получатель вернул ошибку HTTP."),
    payload_too_large: t("auto.testTooLarge", "Тестовые данные превышают допустимый размер."),
    payload_error: t("auto.testPayload", "Не удалось сформировать тестовые данные."),
    request_error: t("auto.testRequest", "Не удалось выполнить тест. Проверьте доступ и соединение; перед повтором проверьте получателя."),
  };
  return <div className="space-y-1.5">
    <Button type="button" variant="outline" size="sm" data-testid="webhook-test-button"
      disabled={!valid || mutation.isPending} onClick={() => void run()}>
      {mutation.isPending ? t("auto.testSending", "Отправка…") : t("auto.testButton", "Тест")}
    </Button>
    <p className="text-xs text-slate-500">{t("auto.testHint", "Отправит вымышленные данные по текущему URL без сохранения автоматизации и записи в ERP. Сценарий получателя может запуститься. Данные помечены test: true.")}</p>
    {!valid && url && <p className="text-xs text-amber-700">{errors.invalid_url}</p>}
    {result && <p role="status" data-testid="webhook-test-result" className={`text-xs ${result.ok ? "text-green-700" : "text-red-600"}`}>
      {result.ok ? t("auto.testSuccess", "Тест отправлен, получен успешный ответ.") : errors[result.error ?? ""] ?? errors.request_error}
      {result.statusCode ? ` HTTP ${result.statusCode}` : ""}
    </p>}
  </div>;
}
