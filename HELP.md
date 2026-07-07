# Шпаргалка по командам

Короткий справочник: как собрать релиз, обновить сервер и что важно знать про
файлы и переменные окружения.

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

## 3. Обновление удалённого сервера (по SSH)

```bash
ssh user@your-server
cd /path/to/app
./deploy.sh
```

`deploy.sh` по шагам: бэкап БД → `git pull` → установка зависимостей →
`migrate` (применит только новые миграции) → сборка → рестарт сервиса.

Настройки скрипта (в шапке `deploy.sh` или через переменные окружения):
- `RESTART_CMD` — команда рестарта, напр. `pm2 restart api-server`
  или `sudo systemctl restart erp-api`
- `BRANCH` — ветка для деплоя (по умолчанию `main`)
- `BACKUP_DIR` — куда складывать бэкапы БД (по умолчанию `.db-backups/`)

Откат БД из бэкапа, если что-то пошло не так:

```bash
gunzip -c .db-backups/pre_deploy_ГГГГММДД_ЧЧММСС.sql.gz | psql "$DATABASE_URL"
```

### Первый запуск на сервере (разово)

```bash
# на Replit — выгрузить ТОЛЬКО данные (схему создаст migrate):
pg_dump --data-only --disable-triggers "$DATABASE_URL" | gzip > seed.sql.gz

# на сервере (пустая БД):
git clone <repo> && cd <repo>
cp .env.example .env         # заполнить значения
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run migrate     # создаст схему + запишет версию
gunzip -c seed.sql.gz | psql "$DATABASE_URL" # зальёт данные
pnpm run build
# запустить сервис (pm2 / systemd)
```

---

## 4. Переменные окружения

Шаблон — `.env.example`. Скопируйте и заполните:

```bash
cp .env.example .env
```

Обязательные: `DATABASE_URL`, `PORT`, `SESSION_SECRET`, `NODE_ENV=production`.
Реальный `.env` в git не попадает (см. `.gitignore`).

---

## 5. Файлы и хранилище (важно для своего сервера)

Загружаемые файлы (лого в настройках, файловые поля с загрузкой «на сервер»)
**не сохраняются в папку проекта** и в GitHub не попадают — они уходят в
**Replit Object Storage** (облачный бакет) через внутренний сервис Replit.

⚠️ Это работает **только внутри Replit**. На своём сервере этот механизм
недоступен, поэтому загрузку файлов «на сервер» нужно будет перевести на другой
бэкенд хранилища (например, S3-совместимое хранилище или локальный диск).
Google Drive и вставленные ссылки на файлы от этого не зависят и продолжат
работать. Если планируете активно пользоваться загрузкой файлов на своём
сервере — это отдельная доработка, скажите, и настроим.

---

## 6. Что НЕ уходит в GitHub

Игнорируется через `.gitignore`:
- `attached_assets/` — рабочие скриншоты/заметки из процесса разработки
- `.env`, `.env.local` — секреты
- `.db-backups/` — бэкапы БД от `deploy.sh`
- `node_modules/`, `dist/`, `*.tsbuildinfo` — сборка и зависимости

> Папка `attached_assets/` уже была добавлена в git ранее. Чтобы убрать её из
> репозитория (файлы на диске останутся), выполните один раз:
> ```bash
> git rm -r --cached attached_assets
> git commit -m "Stop tracking attached_assets"
> ```
