# Шпаргалка по командам

Короткий справочник: как разрабатывать на Replit, собрать релиз и обновить
рабочий сервер (erp.davidov-k.co.il).

---

## 1. Разработка на Replit

- `pnpm --filter @workspace/api-server run dev` — запустить API-сервер
- `pnpm --filter @workspace/erp-platform run dev` — запустить веб-приложение
- `pnpm --filter @workspace/db run push` — применить изменения схемы БД к dev-базе
  (быстро, **файлов миграций не создаёт** — используйте это во время разработки)
- `pnpm run typecheck` — проверка типов по всему проекту
- `pnpm --filter @workspace/api-spec run codegen` — перегенерировать API-хуки и Zod
  из `openapi.yaml` (после правок контракта)

> Правило: на Replit меняем схему **только** через `push`. Команду `migrate`
> здесь запускать НЕ нужно — она только для сервера.

---

## 2. Сборка релиза (перед заливкой в GitHub)

Одна команда:

```bash
pnpm run release
```

Она делает:
1. `typecheck` — не даёт залить код с ошибками типов;
2. `generate` — собирает **все** накопленные изменения схемы БД в **один** новый
   файл `lib/db/drizzle/000N_*.sql` и обновляет снимок в `drizzle/meta/`.

Если схему не меняли — честно скажет «No schema changes» и файл не создаст.

Дальше:

```bash
git add -A
git commit -m "Описание релиза"
git push
```

Обязательно коммитьте папку `lib/db/drizzle/` — это история схемы БД.

---

## 3. Обновление рабочего сервера (по SSH)

Сервер: `erp.davidov-k.co.il`, проект в `~/www/erp.davidov-k.co.il`,
бэкенд крутится в PM2 под именем `erp-davidov` (порт 10000), статику отдаёт nginx.

Стандартное обновление:

```bash
cd ~/www/erp.davidov-k.co.il
git pull origin main
pnpm install
pnpm --filter @workspace/api-server run build
PORT=10000 BASE_PATH=/ pnpm --filter @workspace/erp-platform run build
pm2 restart erp-davidov --update-env
```

Важно:
- Собираем **два пакета по отдельности** (`--filter`). Общий `pnpm run build`
  на сервере не подойдёт — он падает на ненужном там пакете mockup-sandbox.
- Для фронтенда переменные `PORT=10000 BASE_PATH=/` перед командой обязательны.
- Фронтенд — это статические файлы (`artifacts/erp-platform/dist/public`),
  nginx подхватывает их сразу после сборки; PM2 перезапускаем только ради бэкенда.

Если менялся `.env` (новые переменные):

```bash
set -a; source .env; set +a
pm2 restart erp-davidov --update-env
```

Если в релизе менялась **схема БД** — перед перезапуском примените миграции
(сначала желательно сделать бэкап, см. ниже):

```bash
set -a; source .env; set +a
pnpm --filter @workspace/db run migrate
```

Бэкап БД перед миграцией и откат:

```bash
mkdir -p .db-backups
pg_dump "$DATABASE_URL" | gzip > .db-backups/pre_deploy_$(date +%Y%m%d_%H%M%S).sql.gz

# откат, если что-то пошло не так:
gunzip -c .db-backups/pre_deploy_ГГГГММДД_ЧЧММСС.sql.gz | psql "$DATABASE_URL"
```

Есть и скрипт `./deploy.sh`, который делает всё это по шагам
(бэкап → pull → install → migrate → build → restart). Перед использованием
задайте команду рестарта: `RESTART_CMD="pm2 restart erp-davidov --update-env"`.

---

## 4. Nginx и FastPanel (⚠️ важно)

Конфиг сайта: `/etc/nginx/fastpanel2-available/ordis_co_il_usr/erp.davidov-k.co.il.conf`

**FastPanel перезаписывает этот файл** при любом изменении настроек сайта в
панели — и сайт «ломается» (всё снова проксируется на бэкенд). Лечение:
восстановить конфиг из бэкапа и перезагрузить nginx:

```bash
sudo cp ~/erp-nginx-backup.conf /etc/nginx/fastpanel2-available/ordis_co_il_usr/erp.davidov-k.co.il.conf
sudo nginx -t && sudo systemctl reload nginx
```

Бэкап рабочего конфига лежит в `~/erp-nginx-backup.conf`
(`/var/www/ordis_co_il_usr/data/erp-nginx-backup.conf`). Если правите конфиг —
обновляйте и бэкап.

Ключевые отличия рабочего конфига от того, что генерирует панель:
1. `root` указывает на `.../erp.davidov-k.co.il/artifacts/erp-platform/dist/public`
2. `location ^~ /api { proxy_pass ...; }` — на бэкенд уходит только API
   (`^~` обязателен, иначе блок расширений перехватывает картинки из `/api/storage/...`)
3. `location / { try_files $uri /index.html; }` — SPA-фолбэк для фронтенда
4. Блок расширений файлов — `try_files $uri =404;` (без `@fallback`)

---

## 5. Переменные окружения

Шаблон — `.env.example`. Скопируйте и заполните:

```bash
cp .env.example .env
```

Обязательные: `DATABASE_URL`, `PORT`, `SESSION_SECRET`, `NODE_ENV=production`.
Полезные: `UPLOADS_DIR` — папка для загружаемых файлов (по умолчанию `./uploads`).

Реальный `.env` в git не попадает (см. `.gitignore`).

> PM2 запоминает переменные окружения **на момент старта**. После правки `.env`
> обязательно: `set -a; source .env; set +a; pm2 restart erp-davidov --update-env`.

---

## 6. Файлы и хранилище

Загружаемые файлы (лого в настройках, файловые поля с загрузкой «на сервер»)
хранятся **на локальном диске** в папке `uploads/` в корне проекта
(путь можно поменять через `UPLOADS_DIR`):

- `uploads/branding/` — лого платформы; **коммитится в git**, приезжает на сервер сама
- `uploads/files/` — файлы из записей и корзина; **в git НЕ попадает** —
  на сервере живёт своей жизнью, включайте эту папку в бэкапы сервера

Google Drive и вставленные ссылки на файлы от локального диска не зависят —
в БД хранится только ссылка.

---

## 7. Что НЕ уходит в GitHub

Игнорируется через `.gitignore`:
- `attached_assets/` — рабочие скриншоты/заметки из процесса разработки
- `.env`, `.env.local` — секреты
- `uploads/files/` — загруженные файлы записей (данные пользователей)
- `.db-backups/` — бэкапы БД
- `node_modules/`, `dist/`, `*.tsbuildinfo` — сборка и зависимости

---

## 8. Особенности именно этого сервера (Beget + FastPanel)

- Реестр npm заблокирован — pnpm на сервере настроен на зеркало
  `npmmirror.com` (уже сделано, трогать не нужно).
- Оперативной памяти мало — добавлен swap-файл 2 ГБ (уже в fstab).
- Node 24 и pnpm 11 установлены через corepack.
- Первичная настройка (клонирование, БД, PM2, nginx) уже выполнена —
  повторять её не нужно, для обновлений достаточно раздела 3.
