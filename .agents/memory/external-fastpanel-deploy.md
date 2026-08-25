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
If `.env` changed, source it before restarting: `set -a; source .env; set +a;` then `pm2 restart erp-davidov --update-env`.

## Verify Git synchronization before building
- The production checkout can retain local modifications to tracked package/workspace files. Preserve them deliberately, but never treat a completed build as proof that Git synchronized: an old checkout can build successfully.
- Before building, run `git fetch origin`, fast-forward with `git pull --ff-only origin main`, and verify `git rev-parse HEAD` equals `git rev-parse origin/main`. Also verify any newly added critical source file exists.

**Why:** A formula fix existed on `origin/main` while the production checkout remained on an older `main`; the old source still compiled, so install/build/restart produced a healthy but stale application.

**How to apply:** Make commit equality a release gate. If tracked server-only package files complicate pulls, stash only those files, pull, then reapply them; keep uploads and `.env` outside Git.

## Production DB schema changes
- Do not accumulate manual SQL handover files, root dumps, or stale full-schema sync scripts in the repository. Production is current; completed one-off SQL is removed after use.
- Keep `lib/db/drizzle/` intact as the canonical schema history for fresh installs and future migrations.
- Production migration 0004 was applied manually, so automatic `migrate` must not be run until its ledger state is reconciled; otherwise it may repeat already-applied DDL.

**Why:** mixing generated migrations, recovery scripts, dumps, and one-off handovers created clutter and made deployment instructions ambiguous.

**How to apply:** for each future schema change, generate the normal Drizzle migration. Before deploying it, verify production's migration ledger and schema; if a manual SQL handover is explicitly needed, agree on one temporary path and remove the file after production is verified.

## Build/install quirks on that server
- npmjs registry is blocked → registry permanently set to npmmirror.com; fetch-timeout 600000, network-concurrency 3, child-concurrency 1. Lockfile tarball URLs pinned to npmjs may need sed-patching on the server (happened with npm-run-path@6.0.0).
- esbuild build script must be allowed (`allowBuilds` in pnpm-workspace.yaml) + `pnpm -r rebuild esbuild`; the esbuild "bin check" ELF SyntaxError is cosmetic.
- Root `pnpm build` fails on mockup-sandbox — build api-server and erp-platform with `--filter` instead.
- Low RAM: a 2G swapfile was added (fstab) after OOM kills during install/build.

- Google Drive own-keys OAuth: redirect URI is derived from the request host (x-forwarded-host/Host), no REPLIT_DOMAINS needed on the external server. The Google OAuth app must be PUBLISHED (In production, no verification needed) — Testing mode revokes refresh tokens after 7 days, so Drive drops weekly.

## Schema drift after code-only deploy (Aug 2026)
- Symptom set: "values disappeared" / empty admin lists / "Аккаунт —" right after a git-pull deploy = missing `db push` on prod (Drizzle selects new columns → queries 500 → UI renders empty; data is intact). Check `pm2 logs erp-api` for `column ... does not exist`.
- Resolve drift from the canonical Drizzle schema/migration after checking the production ledger; do not recreate a persistent catch-all sync SQL.
