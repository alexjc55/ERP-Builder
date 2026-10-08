---
name: Security audit purpose and limits
description: Forensic access-chain reconstruction, evidence boundaries and prevention rollout requirements.
---

The user wants to reconstruct how administrative access was obtained, not merely
see which account performed the final action. Link authentication, session,
agent/integration identity and privileged mutations; distinguish authenticated
identity from an unverified token's claims.

**Why:** An actor account ID does not identify the human who used its credentials.
The user explicitly distinguishes investigation from prevention.

**How to apply:** Never treat an IP or account ID as proof of a person's identity.
Trust forwarded IPs only after explicit proxy-topology configuration, not by
default. Never retain credential values in evidence. Review/acknowledgment must
not erase evidence. Explain that HTTP evidence does not cover direct SQL/SSH or
recover unlogged past activity. An incomplete request is not proof of rollback.
Administrator MFA and step-up protections need an enrollment/recovery path
before enforcement; do not silently lock the owner out.

Human-readable object names must accompany forensic IDs where available.

**Why:** The user cannot identify people from numeric IDs in the ordinary admin
screens and explicitly requested names for users, entities and records in audit details.

**How to apply:** Keep IDs for tracing, distinguish the actor from the affected
object, and clearly distinguish current lookup names from historical evidence.
Do not fabricate historical names for deleted objects or infer a person's identity
from an account name.

Ограничение входа в ERP списком разрешённых IP пользователю не подходит.

**Why:** Пользователь прямо указал это при обсуждении установки журнала безопасности.

**How to apply:** Не вводить ограничение входа по IP без отдельного согласования.
Объяснять, что доверенные прокси определяют источник адреса для журнала,
а не список пользователей или сетей, которым разрешён вход.

Управление хранением обязательно: пользователь обеспокоен неконтролируемым ростом
журнала. По умолчанию обычные события хранятся 30 дней, важные — 180 дней.

**Why:** Пользователь одобрил автоматическую очистку и объединение повторов,
но свежие важные события нельзя молча удалять ради размера.

**How to apply:** Порог размера — предупреждение, не жёсткий лимит с вытеснением
свежих событий. Для повторов срок считается от последнего появления. Утрата
подробностей при переполнении агрегации должна явно обозначаться. Изменение
сроков требует подтверждения необратимого удаления. Ротация PM2/nginx не входит
в очистку журнала БД; не выдавать одно за другое.

Отказы после массового завершения сессий не следует автоматически трактовать
как атаку или скрывать: допустимо объединять их с сохранением источника,
сессии, количества и временного диапазона, явно обозначая неполные детали.

**Why:** Пользователь наблюдал длительные серии запросов со старых вкладок
после собственного завершения всех сессий; отдельные тревоги загромождали аудит.

**How to apply:** Не смешивать разные сессии и источники без явного обозначения
переполнения. Не переносить это послабление на успешные изменения прав или данных.
Снижение числа строк не означает снижение числа запросов: оценивать оба показателя.
