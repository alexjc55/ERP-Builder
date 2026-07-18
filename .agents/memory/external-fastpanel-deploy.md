---
name: External FastPanel/Beget deploy
description: How the ERP is deployed to the external Debian/FastPanel server (erp.davidov-k.co.il) and the quirks that will bite again.
---

# External deploy: erp.davidov-k.co.il (Beget shared server, FastPanel)

Production runs OUTSIDE Replit on a Debian server with FastPanel (user `ordis_co_il_usr`, home `/var/www/ordis_co_il_usr/data`, project at `~/www/erp.davidov-k.co.il`, IP 178.236.17.141).

## Topology
- Node 24 + pnpm 11 (corepack). API under PM2 as `erp-davidov` on port 10000: `set -a; source .env; set +a; pm2 start artifacts/api-server/dist/index.mjs --name erp-davidov --node-args="--enable-source-maps"; pm2 save`. api-server serves ONLY /api; env is captured by PM2 at start (no dotenv).
- Frontend is a static build: `PORT=10000 BASE_PATH=/ pnpm --filter @workspace/erp-platform run build` → `artifacts/erp-platform/dist/public`, served by nginx.
- DB: local Postgres, db `erp_davidov`, user `erp_davidov_usr` (in `.env`).

## Nginx (the recurring problem)
- Config file: `/etc/nginx/fastpanel2-available/ordis_co_il_usr/erp.davidov-k.co.il.conf`.
- **FastPanel REGENERATES this file** on any site-settings change in the panel, reverting it to proxy-everything. Fix = restore from backup `~/erp-nginx-backup.conf` (`/var/www/ordis_co_il_usr/data/erp-nginx-backup.conf`), then `sudo nginx -t && sudo systemctl reload nginx`.
- Required edits vs the panel default:
  1. `set $root_path .../erp.davidov-k.co.il/artifacts/erp-platform/dist/public;`
  2. `location ^~ /api { proxy_pass http://erp.davidov-k.co.il; include /etc/nginx/proxy_params; }` — `^~` is critical or the static-extensions regex block intercepts `/api/storage/*.png`.
  3. `location / { try_files $uri /index.html; }` (SPA fallback).
  4. Extensions block → `try_files $uri =404;`, delete `@fallback`.

## Standard update procedure (given to the user)
```bash
cd ~/www/erp.davidov-k.co.il
git pull origin main
pnpm install
pnpm --filter @workspace/api-server run build
PORT=10000 BASE_PATH=/ pnpm --filter @workspace/erp-platform run build
pm2 restart erp-davidov --update-env
```
If `.env` changed or DB schema changed, source env first: `set -a; source .env; set +a;` then `pm2 restart erp-davidov --update-env` / `pnpm --filter @workspace/db run push`.

## Delivering DB changes as SQL files
- Schema/translation changes for prod are delivered as an idempotent .sql file (plus a .txt copy — the chat asset viewer rejects .sql) that the USER runs on the remote Postgres; NEVER run them against the Replit DB.
- File conventions: `ADD COLUMN IF NOT EXISTS`, translations via `INSERT ... ON CONFLICT (translation_key) DO UPDATE SET translations_json = EXCLUDED.translations_json, updated_at = now()`, Russian comments, "повторный запуск безопасен".
- User runs it on the server: `psql -U erp_davidov_usr -d erp_davidov -f file.sql` (or paste into psql); credentials are in the project `.env` on the server.
- The user often runs these files through a web SQL GUI, not psql — do NOT include psql metacommands (`\set ON_ERROR_STOP on` etc.), they throw a syntax error there. Plain SQL + BEGIN/COMMIT only.

## Build/install quirks on that server
- npmjs registry is blocked → registry permanently set to npmmirror.com; fetch-timeout 600000, network-concurrency 3, child-concurrency 1. Lockfile tarball URLs pinned to npmjs may need sed-patching on the server (happened with npm-run-path@6.0.0).
- esbuild build script must be allowed (`allowBuilds` in pnpm-workspace.yaml) + `pnpm -r rebuild esbuild`; the esbuild "bin check" ELF SyntaxError is cosmetic.
- Root `pnpm build` fails on mockup-sandbox — build api-server and erp-platform with `--filter` instead.
- Low RAM: a 2G swapfile was added (fstab) after OOM kills during install/build.
