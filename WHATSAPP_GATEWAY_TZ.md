# Техническое задание: Multi-account WhatsApp Gateway на базе Baileys

## 1. Общая задача

Создай самостоятельный серверный проект **WhatsApp Gateway**, который позволяет внешним системам отправлять WhatsApp-сообщения через подключённые WhatsApp-аккаунты.

Gateway должен:

- работать как отдельный сервис с собственным REST API;
- использовать библиотеку `@whiskeysockets/baileys`;
- поддерживать подключение нескольких WhatsApp-номеров;
- подключать существующие номера через QR-код или pairing code как связанные устройства;
- сохранять WhatsApp-сессии между перезапусками;
- принимать запросы на отправку сообщений от ERP, Make и других проектов;
- отправлять сообщения через очередь и фонового worker;
- обеспечивать idempotency, повторы и контроль скорости;
- отправлять подписанные webhooks о статусах сообщений;
- предоставлять защищённую административную панель для управления номерами и просмотра сообщений.

Это **отдельный продукт и отдельный Replit artifact**, а не часть существующей ERP.

## 2. Важные ограничения

Baileys является неофициальной интеграцией с WhatsApp Web.

Архитектура должна учитывать:

- неожиданное отключение WhatsApp-сессии;
- необходимость повторного QR/pairing;
- изменение протокола WhatsApp;
- временные ошибки и ограничения;
- риск блокировки WhatsApp-аккаунта;
- невозможность гарантировать доставку;
- необходимость ограничения частоты отправки;
- запрет массового спама.

Не использовать официальный Meta WhatsApp Business API в первой версии.

Не связывать Gateway напрямую с кодовой базой конкретной ERP. Интеграция должна выполняться только через REST API и webhooks.

## 3. Хранение файлов

В проекте **не использовать Replit Object Storage или другое управляемое Replit-хранилище файлов**.

Если Gateway нужны файлы, использовать постоянные папки самого проекта или сервера:

```text
./data/
./data/whatsapp/
./data/uploads/
./data/temp/
```

Требования:

- пути должны настраиваться через environment variables;
- в production разрешать абсолютные пути вне каталога исходного кода, например `/var/lib/whatsapp-gateway`;
- не хранить важные данные только во временной директории `/tmp`;
- проверять пути и блокировать path traversal;
- ограничивать размер загружаемых файлов;
- создавать каталоги при запуске, если они отсутствуют;
- документировать права доступа к каталогам;
- не коммитить содержимое рабочих каталогов в Git;
- добавить рабочие каталоги в `.gitignore`;
- резервные копии файлов и сессий должен выполнять администратор сервера;
- временные файлы должны автоматически удаляться;
- WhatsApp auth state необходимо шифровать перед сохранением.

Для MVP предпочтительно хранить WhatsApp auth state в PostgreSQL в зашифрованном виде. Если отдельные части Baileys auth state сохраняются в файлах, они должны находиться в настраиваемой persistent-папке проекта/сервера и быть зашифрованы.

## 4. Предпочтительный стек

Используй:

- Node.js;
- TypeScript;
- Fastify или Express;
- `@whiskeysockets/baileys`;
- PostgreSQL;
- Drizzle ORM;
- React + Vite для административной панели;
- Zod для валидации;
- OpenAPI 3.1 как контракт API;
- Pino для структурированных логов;
- PostgreSQL-backed очередь для MVP;
- Vitest или Node Test Runner для тестов.

Для первой версии не добавляй Redis, если очередь можно надёжно реализовать на PostgreSQL. Архитектура очереди должна позволять позже перейти на Redis/BullMQ без изменения публичного API.

Проект должен нормально работать в Replit и на внешнем Debian-сервере под PM2.

## 5. Архитектура

Раздели систему как минимум на следующие компоненты:

```text
Admin Web UI
      |
      v
Gateway REST API
      |
      +--> PostgreSQL
      |
      +--> Instance Manager
      |       |
      |       +--> Baileys session 1
      |       +--> Baileys session 2
      |       +--> Baileys session N
      |
      +--> Message Queue
              |
              v
         Message Worker
              |
              v
           Baileys
```

Логически раздели:

1. HTTP API.
2. Административную панель.
3. WhatsApp Instance Manager.
4. Очередь сообщений.
5. Worker отправки.
6. Webhook Dispatcher.
7. Persistence layer.
8. Аутентификацию и аудит.

API и worker могут первоначально запускаться в одном Node.js-приложении, но код должен позволять позже вынести worker в отдельный процесс.

## 6. Основные термины

### 6.1. Instance

`Instance` — одно подключение к одному WhatsApp-аккаунту.

Примеры:

```text
project-manager-1
sales-office
support
```

У каждого instance должны быть:

- уникальный ID;
- человекочитаемое имя;
- slug или внешний ключ;
- WhatsApp JID после подключения;
- номер телефона после подключения;
- статус;
- параметры rate limiting;
- зашифрованное auth state;
- дата последнего успешного подключения;
- последняя ошибка;
- флаг активности.

`instanceId` не является секретом и сам по себе не должен давать доступ к отправке сообщений.

### 6.2. Client application

`Client application` — внешняя система, которая обращается к Gateway:

- ERP;
- CRM;
- Make;
- интернет-магазин;
- другой проект.

У каждого клиента должны быть собственные credentials и права только на разрешённые WhatsApp instances.

Не выдавать внешним системам общий master key Gateway.

## 7. Доступ внешних сервисов, включая Make

Для интеграции с Make или другим внешним сервисом **не требуется обязательно указывать URL или IP-адреса серверов Make**.

Основной механизм доступа:

1. Администратор создаёт `client application`, например `Make Production`.
2. Gateway генерирует `clientId` и секретный API key.
3. Секрет показывается администратору только один раз.
4. Клиенту выдаётся доступ только к выбранным WhatsApp instances.
5. Make передаёт credential в HTTPS-запросе.
6. Gateway проверяет credential, права клиента и rate limit.

Простой вариант заголовка:

```http
Authorization: Bearer <CLIENT_API_KEY>
```

Более защищённый вариант для систем, поддерживающих подписи:

```http
X-Client-Id: client_make_production
X-Timestamp: 1787745600
X-Request-Id: unique-request-id
X-Signature: hmac-sha256-signature
```

Для первого MVP Bearer API key через HTTPS допустим, если:

- ключ случайный и достаточно длинный;
- в БД хранится только безопасный hash ключа;
- ключ можно отозвать и перевыпустить;
- ключ ограничен конкретными instances;
- включены rate limits;
- все вызовы записываются в аудит;
- ключ никогда не передаётся в URL query string;
- ключ не выводится в логах;
- Make хранит ключ в своём защищённом connection/secret поле.

IP allowlist является дополнительным уровнем защиты, а не обязательным условием. Его можно включить для клиента, если у клиента есть стабильные опубликованные исходящие IP-адреса. Для Make IP allowlist не должен быть обязательным, поскольку набор исходящих адресов может зависеть от региона и тарифа.

Если Gateway должен отправлять результат обратно в Make, администратор настраивает конкретный Make webhook URL в настройках client application. Это отдельная настройка и не связана с разрешением Make вызывать Gateway.

## 8. Управление WhatsApp instances

Администратор должен иметь возможность:

- создать instance;
- указать его имя и slug;
- запустить подключение;
- получить QR-код;
- при возможности получить pairing code;
- видеть текущий статус подключения;
- видеть подключённый номер телефона;
- отключить instance;
- повторно подключить instance;
- удалить сохранённую сессию;
- архивировать или деактивировать instance;
- посмотреть последнюю ошибку;
- посмотреть дату последнего подключения.

Минимальные статусы:

```text
created
connecting
qr_required
pairing_required
connected
reconnecting
disconnected
logged_out
error
disabled
```

Статус должен обновляться по событиям Baileys.

После перезапуска приложения Gateway должен автоматически восстанавливать активные сессии.

Если WhatsApp сообщил `logged_out`, нельзя бесконечно переподключаться. Instance должен перейти в состояние, требующее ручного повторного подключения.

## 9. QR-код и pairing

QR-код и pairing code являются чувствительными данными.

Требования:

- показывать их только авторизованному администратору;
- не включать QR/pairing в обычные логи;
- не предоставлять публичную ссылку без авторизации;
- ограничить срок действия;
- не кэшировать HTTP-ответ браузером;
- не сохранять QR-код после завершения подключения;
- поддержать обновление QR через polling или Server-Sent Events.

## 10. Отправка сообщений

MVP должен поддерживать исходящие текстовые сообщения.

Запрос должен содержать:

- instance;
- номер получателя;
- текст;
- обязательный `idempotencyKey`;
- необязательный внешний reference;
- необязательные metadata.

Gateway должен:

1. Проверить клиента и его credential.
2. Проверить права клиента на instance.
3. Нормализовать номер.
4. Провести валидацию.
5. Проверить idempotency.
6. Создать сообщение со статусом `queued`.
7. Вернуть ответ, не ожидая фактической отправки.
8. Отправить сообщение через worker.
9. Сохранить внешний WhatsApp message ID.
10. Обновлять статус по событиям Baileys.
11. При необходимости отправить webhook клиенту.

Номер хранить в нормализованном международном формате без пробелов и знака `+`, например:

```text
972501234567
```

Не пытаться автоматически угадывать страну. Если номер передан без международного кода и не настроена страна по умолчанию, возвращать ошибку валидации.

## 11. Статусы сообщений

Минимальный внутренний набор статусов:

```text
queued
processing
sent
delivered
read
retry_scheduled
failed
cancelled
```

Не все версии WhatsApp/Baileys гарантированно возвращают `delivered` и `read`. Система должна корректно работать и без этих событий.

Для каждого изменения статуса сохранять историю.

## 12. Idempotency

`idempotencyKey` обязателен для каждого запроса отправки.

Уникальность:

```text
clientId + idempotencyKey
```

Если клиент повторяет тот же запрос:

- не создавать новое сообщение;
- не отправлять его повторно;
- вернуть исходное сообщение и текущий статус.

Если тот же ключ повторно используется с другим instance, получателем или текстом, вернуть `409 Conflict`.

## 13. Очередь и worker

Очередь должна храниться в PostgreSQL и переживать перезапуски.

Worker должен:

- атомарно захватывать задания;
- исключать параллельную отправку одного задания;
- использовать `FOR UPDATE SKIP LOCKED` или аналогичный безопасный механизм;
- восстанавливать зависшие задания после timeout;
- поддерживать retry;
- соблюдать rate limits для каждого instance;
- не отправлять сообщения через отключённый instance;
- не терять сообщения при перезапуске.

Начальная политика повторов:

```text
Попытка 1: сразу
Попытка 2: через 30 секунд
Попытка 3: через 2 минуты
Попытка 4: через 10 минут
Попытка 5: через 30 минут
```

Постоянные ошибки не повторять бесконечно.

Классифицировать ошибки как минимум на:

- временные;
- постоянные;
- требуется переподключение;
- rate limited;
- некорректный получатель;
- неизвестная ошибка.

## 14. Rate limiting

Нужны ограничения:

- на instance;
- на client application;
- на получателя;
- глобальное ограничение.

Настройки должны храниться в конфигурации или БД.

По умолчанию использовать осторожные лимиты, не предназначенные для массовых рассылок.

Не отправлять много сообщений одновременно через один WhatsApp instance. Использовать последовательную или ограниченную конкурентную отправку.

## 15. Webhooks

Gateway должен уметь уведомлять клиентские приложения о:

- изменении статуса исходящего сообщения;
- отключении WhatsApp instance;
- необходимости повторного подключения;
- успешном восстановлении соединения;
- входящем сообщении, если эта функция будет включена позже.

Пример:

```json
{
  "eventId": "evt_123",
  "eventType": "message.status_changed",
  "createdAt": "2026-08-26T12:00:00.000Z",
  "data": {
    "messageId": "msg_123",
    "externalReference": "order-918",
    "instanceId": "ins_123",
    "status": "delivered"
  }
}
```

Требования к webhooks:

- подпись HMAC-SHA256, когда принимающая система умеет её проверять;
- timestamp;
- уникальный `eventId`;
- защита от replay;
- очередь доставки;
- retry с backoff;
- журнал попыток;
- timeout;
- HTTPS only;
- запрет localhost, private IP и metadata endpoints;
- защита от SSRF;
- возможность отключить endpoint после большого числа постоянных ошибок.

Webhook URL настраивается на уровне client application. Не принимать произвольный callback URL в каждом запросе отправки.

Для Make допускается отдельный webhook endpoint без HMAC-проверки, если конкретный модуль Make не позволяет проверить подпись. В таком случае:

- URL должен содержать созданный Make секретный webhook token;
- endpoint настраивается только администратором;
- webhook payload не должен содержать секреты;
- должна быть возможность быстро заменить URL;
- доставка должна логироваться;
- Gateway API credential и Make webhook token должны быть разными секретами.

## 16. Публичный API

API должен быть versioned:

```text
/api/v1
```

### 16.1. Отправка текста

```http
POST /api/v1/messages
Authorization: Bearer <CLIENT_API_KEY>
Content-Type: application/json
```

Пример запроса:

```json
{
  "instanceId": "ins_123",
  "to": "972501234567",
  "type": "text",
  "text": "Здравствуйте. Ваш заказ готов на производстве.",
  "idempotencyKey": "erp-order-918-ready-v1",
  "externalReference": "order-918",
  "metadata": {
    "source": "erp",
    "automationId": "42"
  }
}
```

Пример ответа:

```json
{
  "id": "msg_123",
  "status": "queued",
  "instanceId": "ins_123",
  "to": "972501234567",
  "externalReference": "order-918",
  "createdAt": "2026-08-26T12:00:00.000Z"
}
```

HTTP status:

```text
202 Accepted
```

### 16.2. Получение сообщения

```http
GET /api/v1/messages/:messageId
```

### 16.3. Список сообщений

```http
GET /api/v1/messages
```

Фильтры:

- instance;
- status;
- external reference;
- получатель;
- период;
- client application.

Использовать pagination.

### 16.4. Отмена сообщения

```http
POST /api/v1/messages/:messageId/cancel
```

Отмена разрешена только до начала фактической отправки.

### 16.5. Instances для внешних клиентов

```http
GET /api/v1/instances
GET /api/v1/instances/:instanceId/status
```

Клиент должен видеть только разрешённые ему instances.

### 16.6. Health endpoints

```http
GET /health/live
GET /health/ready
```

`live` проверяет, что процесс работает.

`ready` проверяет:

- соединение с PostgreSQL;
- запуск worker;
- готовность HTTP API.

Недоступность одного WhatsApp instance не должна делать весь Gateway `not ready`.

## 17. Административный API

Административный API отделить от API внешних клиентов.

Пример маршрутов:

```text
/api/admin/v1/instances
/api/admin/v1/messages
/api/admin/v1/clients
/api/admin/v1/webhooks
/api/admin/v1/audit
```

Администратор должен иметь возможность:

- управлять instances;
- подключать номера;
- управлять client applications;
- выпускать и отзывать API keys;
- выдавать клиенту доступ к определённым instances;
- настраивать webhook endpoint;
- видеть сообщения и ошибки;
- повторно поставить failed message в очередь;
- отменить queued message;
- видеть webhook deliveries;
- просматривать аудит.

## 18. Аутентификация и авторизация

### 18.1. Административная панель

Для административной панели используй нормальную пользовательскую аутентификацию.

Если проект создаётся в Replit и доступна управляемая авторизация, используй поддерживаемое Replit решение. Не создавай небезопасную самодельную систему хранения паролей.

Минимальные роли:

```text
super_admin
operator
viewer
```

Права:

- `super_admin` — все операции;
- `operator` — подключение instances и работа с сообщениями;
- `viewer` — только просмотр.

### 18.2. Внешние приложения

Каждый client application должен иметь:

- название;
- статус;
- один или несколько отзываемых API keys;
- список разрешённых instances;
- webhook endpoint;
- отдельный webhook secret;
- rate limits;
- необязательный IP allowlist.

Секретный API key показывать только при создании. В БД хранить hash ключа.

## 19. Хранение Baileys auth state

Не использовать `useMultiFileAuthState` как финальное production-хранилище без дополнительной защиты.

Сделай абстракцию:

```ts
interface WhatsAppAuthStore {
  load(instanceId: string): Promise<AuthState | null>;
  save(instanceId: string, state: AuthState): Promise<void>;
  delete(instanceId: string): Promise<void>;
}
```

Production-реализация должна:

- хранить auth state в PostgreSQL или persistent-папке проекта/сервера;
- шифровать чувствительные значения перед сохранением;
- использовать ключ шифрования из environment secret;
- поддерживать атомарное обновление;
- не логировать credentials;
- корректно сохранять обновления ключей Baileys;
- позволять создавать резервные копии.

Использовать authenticated encryption, например AES-256-GCM.

Никогда не коммитить encryption key в Git.

## 20. Предлагаемая модель данных

Точные названия можно скорректировать, но нужны следующие сущности.

### `users`

Администраторы панели.

### `whatsapp_instances`

```text
id
name
slug
status
phone_number
whatsapp_jid
is_active
rate_limit_config
last_connected_at
last_disconnected_at
last_error_code
last_error_message
created_at
updated_at
```

### `whatsapp_auth_states`

```text
instance_id
encrypted_payload
encryption_version
updated_at
```

### `client_applications`

```text
id
name
status
webhook_url
encrypted_webhook_secret
rate_limit_config
ip_allowlist
created_at
updated_at
```

### `client_api_keys`

```text
id
client_id
name
key_prefix
secret_hash
last_used_at
expires_at
revoked_at
created_at
```

### `client_instance_permissions`

```text
client_id
instance_id
can_send
can_view_status
```

### `messages`

```text
id
client_id
instance_id
direction
type
recipient
text
status
idempotency_key
external_reference
metadata_json
whatsapp_message_id
attempt_count
next_attempt_at
processing_started_at
locked_by
last_error_code
last_error_message
created_at
sent_at
delivered_at
read_at
failed_at
updated_at
```

Обеспечить уникальность:

```text
client_id + idempotency_key
```

### `message_status_history`

```text
id
message_id
old_status
new_status
details_json
created_at
```

### `webhook_events`

```text
id
client_id
event_type
payload_json
status
attempt_count
next_attempt_at
created_at
delivered_at
```

### `webhook_delivery_attempts`

```text
id
event_id
attempt_number
http_status
response_excerpt
error_message
duration_ms
created_at
```

Не сохранять полный ответ webhook, если в нём могут находиться секреты или персональные данные.

### `audit_log`

```text
id
actor_type
actor_id
action
resource_type
resource_id
details_json
ip_address
created_at
```

## 21. Административная панель

Создай практичный интерфейс без лишней декоративности.

### Dashboard

Показывать:

- количество connected instances;
- количество disconnected instances;
- queued messages;
- failed messages;
- сообщения за последние 24 часа;
- последние критические ошибки.

### Instances

Таблица:

- имя;
- номер;
- статус;
- последняя активность;
- число сообщений в очереди;
- последняя ошибка;
- действия.

Страница instance:

- текущий статус;
- QR/pairing;
- подключить;
- переподключить;
- отключить;
- сбросить сессию;
- настройки rate limit;
- выданные client permissions;
- последние сообщения;
- журнал событий соединения.

Опасные действия должны требовать подтверждения.

### Messages

Фильтры:

- период;
- instance;
- клиент;
- статус;
- получатель;
- external reference.

Показывать:

- ID;
- получателя;
- instance;
- client application;
- статус;
- попытки;
- дату;
- ошибку;
- историю статусов.

### Clients

Управление внешними приложениями:

- создать клиента;
- деактивировать;
- выпустить API key;
- отозвать API key;
- выдать доступ к instances;
- настроить webhook;
- настроить необязательный IP allowlist;
- показать новый API key только один раз.

### Webhooks

Показывать:

- события;
- попытки;
- HTTP status;
- следующую попытку;
- последнюю ошибку;
- возможность безопасно повторить доставку.

### Audit

Показывать административные действия и использование API credentials.

## 22. Входящие сообщения

Входящие сообщения не обязательны для первой версии, но архитектура не должна препятствовать их добавлению.

На первом этапе:

- принимать событие от Baileys;
- безопасно логировать технический факт получения;
- не создавать автоматических ответов;
- не отправлять содержимое внешним клиентам, пока функция явно не включена.

Подготовить внутренний интерфейс обработчика, но не расширять MVP без необходимости.

## 23. Вложения

В первой версии реализовать только текст.

Архитектура `messages.type` должна предусматривать:

```text
text
image
document
audio
video
```

Не реализовывать вложения фиктивно. Если тип пока не поддерживается, API должен вернуть понятную ошибку `unsupported_message_type`.

Когда вложения будут добавлены, файлы должны храниться только в настроенной persistent-папке проекта/сервера, без Replit Object Storage.

## 24. Логирование и приватность

Использовать структурированные JSON-логи.

Логировать:

- instance ID;
- message ID;
- client ID;
- API key ID или безопасный prefix, но не сам ключ;
- status;
- код ошибки;
- длительность операции.

Не логировать:

- Baileys credentials;
- encryption keys;
- API keys;
- webhook secrets;
- QR-коды;
- pairing codes;
- полный текст сообщений по умолчанию;
- полные номера телефонов без необходимости.

Добавить redaction для чувствительных полей.

## 25. Надёжность

Система должна корректно работать при:

- перезапуске приложения;
- кратковременной недоступности PostgreSQL;
- потере соединения с WhatsApp;
- повторном webhook;
- повторном запросе ERP или Make;
- зависшем worker;
- одновременной работе нескольких worker;
- повторном событии статуса от Baileys;
- отключении одного из нескольких instances.

Ошибка одного instance не должна останавливать остальные.

Обработчики событий Baileys не должны создавать необработанные Promise rejection или завершать процесс.

## 26. Deployment

Подготовь проект к двум вариантам запуска.

### 26.1. Replit development

Нужны workflows для:

- web/API приложения;
- тестов или validation;
- миграций, если это соответствует принятой структуре проекта.

Сервис должен:

- слушать `PORT`;
- принимать соединения через Replit preview proxy;
- не использовать hardcoded localhost в браузерном коде;
- иметь корректную регистрацию artifact;
- не использовать Replit Object Storage.

### 26.2. Внешний Debian/FastPanel

Подготовить:

- production build;
- PM2 ecosystem config;
- пример Nginx reverse proxy;
- health endpoints;
- миграционную команду;
- `.env.example` без секретных значений;
- инструкцию запуска после reboot;
- отдельный процесс API;
- при необходимости отдельный процесс worker;
- инструкцию создания persistent-папок и назначения прав;
- инструкцию резервного копирования БД и папок.

Не использовать Docker как обязательное условие.

## 27. Environment variables

Минимальный ожидаемый набор:

```text
NODE_ENV
PORT
DATABASE_URL
SESSION_SECRET
WHATSAPP_AUTH_ENCRYPTION_KEY
WHATSAPP_DATA_DIR
UPLOADS_DIR
TEMP_DIR
ADMIN_APP_URL
PUBLIC_API_URL
WORKER_ID
LOG_LEVEL
```

Если используются дополнительные переменные, описать их в `.env.example`.

Не создавать значения secret автоматически в исходном коде и не использовать небезопасные fallback.

Если обязательный secret отсутствует, приложение должно завершаться с понятной ошибкой.

## 28. OpenAPI и клиентская интеграция

OpenAPI должен быть источником истины для внешнего API.

Документировать:

- authentication;
- headers;
- request schemas;
- response schemas;
- error schemas;
- idempotency;
- webhook schemas;
- webhook signature verification;
- rate-limit responses.

Добавить примеры:

- TypeScript;
- curl;
- Make HTTP module.

Пример curl:

```bash
curl -X POST "https://wa-gateway.example.com/api/v1/messages" \
  -H "Authorization: Bearer YOUR_CLIENT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "instanceId": "ins_123",
    "to": "972501234567",
    "type": "text",
    "text": "Ваш заказ готов",
    "idempotencyKey": "order-918-ready-v1",
    "externalReference": "order-918"
  }'
```

## 29. Формат ошибок

Использовать единый формат:

```json
{
  "error": {
    "code": "INSTANCE_NOT_CONNECTED",
    "message": "The selected WhatsApp instance is not connected",
    "requestId": "req_123",
    "details": {}
  }
}
```

Минимальные коды:

```text
VALIDATION_ERROR
UNAUTHORIZED
FORBIDDEN
INSTANCE_NOT_FOUND
INSTANCE_NOT_CONNECTED
MESSAGE_NOT_FOUND
IDEMPOTENCY_CONFLICT
RATE_LIMITED
UNSUPPORTED_MESSAGE_TYPE
MESSAGE_ALREADY_PROCESSING
MESSAGE_CANNOT_BE_CANCELLED
INTERNAL_ERROR
```

## 30. Тестирование

### Unit tests

Проверить:

- нормализацию номера;
- API key authentication;
- permissions клиента;
- idempotency;
- webhook signature;
- классификацию ошибок;
- retry backoff;
- переходы статусов;
- rate limiting;
- шифрование и расшифровку auth state;
- запрет недопустимых переходов статуса.

### Integration tests

Проверить:

- создание сообщения;
- повтор с тем же idempotency key;
- конфликт payload при повторном ключе;
- запрет доступа клиента к чужому instance;
- отзыв API key;
- атомарный захват queue job;
- восстановление зависшего job;
- webhook retry;
- изоляцию instances.

### Baileys adapter tests

Не требовать реального WhatsApp-аккаунта для обычного test suite.

Создать интерфейс адаптера и test double:

```ts
interface WhatsAppAdapter {
  connect(instanceId: string): Promise<void>;
  disconnect(instanceId: string): Promise<void>;
  sendText(input: SendTextInput): Promise<SendResult>;
}
```

Реальный Baileys adapter подключается в production, fake adapter — только в тестах и явно включённом demo mode.

## 31. Критерии приёмки MVP

MVP считается готовым, если выполняется следующий сценарий:

1. Администратор входит в панель.
2. Создаёт WhatsApp instance.
3. Получает QR-код.
4. Сканирует QR существующим WhatsApp-аккаунтом.
5. Instance становится `connected`.
6. Создаётся client application.
7. Для него выпускается API key.
8. Клиенту выдаётся доступ только к выбранному instance.
9. Make или другая внешняя система отправляет запрос с `instanceId` и API key.
10. Gateway принимает запрос без обязательного IP allowlist.
11. API возвращает `202` и сообщение в статусе `queued`.
12. Worker отправляет сообщение.
13. Статус меняется на `sent`.
14. При наличии события статус меняется на `delivered` или `read`.
15. Клиент получает webhook, если он настроен.
16. Повтор того же API-запроса не отправляет второе сообщение.
17. Клиент не может использовать неразрешённый instance.
18. Отозванный API key перестаёт работать.
19. После перезапуска Gateway WhatsApp-сессия восстанавливается.
20. При logout панель показывает необходимость повторного подключения.
21. Ошибка одного instance не влияет на другие.
22. Тесты и typecheck проходят.
23. В логах отсутствуют QR, credentials и secrets.
24. Проект не использует Replit Object Storage.
25. Проект имеет документацию по development и production deployment.

## 32. Порядок реализации

### Этап 1. Основа

- структура проекта;
- artifact и workflows;
- PostgreSQL;
- миграции;
- OpenAPI;
- health endpoints;
- authentication;
- базовая административная панель.

### Этап 2. Instances

- модель instances;
- Baileys adapter;
- encrypted auth state;
- persistent folders;
- QR/pairing;
- connect/disconnect/reconnect;
- автоматическое восстановление.

### Этап 3. Клиенты и сообщения

- client applications;
- API keys;
- instance permissions;
- внешний API;
- idempotency;
- PostgreSQL queue;
- worker;
- rate limiting;
- retry;
- статусы.

### Этап 4. Webhooks

- webhook events;
- HMAC;
- Make-compatible webhook configuration;
- retries;
- SSRF protection;
- журнал доставки.

### Этап 5. Панель и завершение

- dashboard;
- messages;
- clients;
- webhook deliveries;
- audit;
- тесты;
- deployment documentation;
- production hardening.

## 33. Инструкции агенту Replit

Перед реализацией:

1. Изучи доступные в Replit инструкции для React/Vite, PostgreSQL, authentication, artifacts, workflows, secrets и package management.
2. Создай новый самостоятельный web artifact.
3. Не добавляй код в другой существующий продукт.
4. Не подключай Replit Object Storage.
5. Для файлов сразу используй настраиваемые папки проекта/сервера.
6. Сначала зафиксируй архитектуру и модель данных.
7. Затем реализуй MVP последовательно.
8. Не останавливайся на статическом mockup.
9. Не подменяй Baileys фиктивной реализацией в production.
10. Fake adapter разрешён только для тестов и явно включённого demo mode.
11. Не запрашивай и не показывай secrets в чате.
12. Не делай IP allowlist обязательным для Make.
13. Реализуй отдельные отзываемые API keys и permissions на instances.
14. После реализации:
    - выполни миграции;
    - запусти тесты;
    - запусти typecheck;
    - перезапусти workflows;
    - проверь логи;
    - открой административную панель в preview;
    - проверь отсутствие manifest errors;
    - предоставь инструкцию подключения первого WhatsApp-номера;
    - предоставь инструкцию настройки Make HTTP module.

Если какое-либо решение имеет несколько существенно разных безопасных вариантов, сначала задай один конкретный уточняющий вопрос. В остальных случаях принимай разумное инженерное решение самостоятельно.

## 34. Что не входит в первый MVP

Не включай без отдельного запроса:

- массовые маркетинговые рассылки;
- chatbot;
- AI-ответы;
- групповые чаты;
- управление контактами;
- изменение профиля WhatsApp;
- создание WhatsApp-групп;
- звонки;
- status/stories;
- campaign builder;
- полноценный inbox операторов;
- интеграцию с конкретной ERP;
- автоматическую миграцию на официальный Meta API.

Архитектура не должна мешать последующему добавлению:

- входящих сообщений;
- файлов и media;
- общей переписки;
- официального WhatsApp provider adapter;
- Redis/BullMQ;
- нескольких worker;
- нескольких серверов.

## 35. Короткое начальное сообщение для агента

Перед полным ТЗ можно написать:

> Создай новый самостоятельный production-ready проект WhatsApp Gateway по файлу `WHATSAPP_GATEWAY_TZ.md`. Это должен быть универсальный multi-account сервис на Baileys для ERP, Make и других внешних систем. Начни с анализа требований и архитектуры, после чего реализуй рабочий MVP, а не только план или интерфейс. Не встраивай его в существующий ERP-проект. Не используй Replit Object Storage: для файлов и локальных данных используй настраиваемые persistent-папки проекта/сервера.