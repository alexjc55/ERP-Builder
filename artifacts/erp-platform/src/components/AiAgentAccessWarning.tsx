import type { AiAgent } from "@workspace/api-client-react";
import { AlertTriangle } from "lucide-react";
import { useT } from "@/lib/i18n";

export function AiAgentAccessPolicyNotice() {
  const t = useT();
  return (
    <p className="text-sm text-amber-900 rounded-md border border-amber-200 bg-amber-50 p-3">
      {t("aiAgents.accessPolicy", "Работа от лица пользователя недоступна, если у него есть суперадминистратор или хотя бы одно административное разрешение — в основной или дополнительной роли. Ключ будет возвращать 401, даже в режиме «Только чтение». Это проверяется и после изменения прав пользователя.")}
    </p>
  );
}

export function AiAgentAccessWarning({ agent, roleName }: {
  agent: AiAgent;
  roleName: (id: number) => string;
}) {
  const t = useT();
  const issues = agent.accessIssues ?? [];
  if (!issues.length) return null;
  const messages: Record<NonNullable<AiAgent["accessIssues"]>[number], string> = {
    module_disabled: t("aiAgents.issueModuleDisabled", "Модуль «ИИ-агенты» выключен."),
    agent_disabled: t("aiAgents.issueAgentDisabled", "Агент отключён."),
    account_disabled: t("aiAgents.issueAccountDisabled", "Техническая учётная запись агента заблокирована или отсутствует."),
    linked_user_unavailable: t("aiAgents.issueLinkedUnavailable", "Пользователь, от лица которого работает агент, заблокирован или отсутствует."),
    linked_user_privileged: t("aiAgents.issueLinkedPrivileged", "У связанного пользователя есть права суперадминистратора или административные разрешения. Проверьте его основную и дополнительные роли."),
  };
  return (
    <div role="status" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-medium flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {t("aiAgents.accessBlocked", "Доступ заблокирован — ключ будет возвращать 401")}
      </p>
      <ul className="list-disc ps-5 mt-1 space-y-1">
        {issues.map(issue => <li key={issue}>{messages[issue]}</li>)}
      </ul>
      {agent.actsAsUserId != null && (
        <p className="mt-1">{t("aiAgents.linkedUserId", "Связанный пользователь")}: #{agent.actsAsUserId}</p>
      )}
      {!!agent.accessBlockingRoleIds?.length && (
        <p className="mt-1">{t("aiAgents.blockingRoles", "Роли с административными правами")}: {agent.accessBlockingRoleIds.map(roleName).join(", ")}</p>
      )}
      <p className="mt-2">{t("aiAgents.keyReissueNotFix", "Перевыпуск ключа не устранит эту причину. Исправьте настройки доступа; не отключайте необходимые сотруднику права только ради подключения агента.")}</p>
    </div>
  );
}
