---
name: ERP Builder development roadmap
description: The canonical 16-stage build order for the Production ERP Builder and where to find the source document — use to answer "what's the next stage?".
---

# Development roadmap (16 stages, build bottom-up)

The authoritative roadmap lives in the project at
`attached_assets/Pasted--Development-Roadmap-Production-ERP-Builder--1780595460_1780595460450.txt`
(plus a Master Product Spec and a Technical DB Architecture doc in the same folder).
It is NOT inferable from code — always consult that file before answering "what stage is next".

Stages, in strict order (each must be fully finished + tested before the next):

1. Core Infrastructure — DB, API, React, auth/authz, metadata layer, audit layer
2. Users & Roles — accounts, block, password reset, login history, user settings (lang/RTL/start page)
3. Pages Builder — dynamic menu, nested menus, ordering, no hardcoded pages
4. Entities Builder — define tables via UI, bind entity to a page
5. Fields Builder — field types incl. Text, LongText, Number, Currency, Date, DateTime, Checkbox, Select, MultiSelect, Status, User, File, Image, URL, Relation, Formula; required + unique
6. Records Engine — CRUD + bulk edit + inline editing, Airtable/Sheets-like UX
7. Relations Engine — 1:1, 1:N, N:1, N:N
8. Views Engine — saved views: filter, sort, hidden cols, pinned cols
9. Permissions Engine — L1 page perms, L2 row perms, L3 column perms; complex conditions (e.g. "only current producer's records")
10. Workflow Engine — workflows, statuses, transitions, required-fields-per-transition, actions
11. Archive Engine — archive via status (not a separate table); auto + manual archival; display rules
12. Audit & History — who/when/what changed, old value + new value
13. Localization Engine — all translations in Postgres, NO locale/json/yaml files
14. Event System — internal event bus: record.created/updated/deleted, status.changed, user.created
15. Modules Architecture — plugin infra only (no plugins yet): WhatsApp, Telegram, Google Drive, PDF, CRM, AI later
16. Production ERP Configuration — assemble first real ERP (Проекты, Азманот, Изделия, Производители, Финансы, Архив; roles + workflow + perms + views)

## Current progress (as of 2026-06-05)
Stages 1–9 complete. **Next = Stage 10: Workflow Engine.**
Note: row-level + field-level permissions were briefly mislabeled "Этап 10" in a session
plan, but per the roadmap they are levels 2–3 of Stage 9 (Permissions Engine).

## Cross-cutting rules (apply every stage)
API-first; database-driven UI; metadata-driven; no hardcoded business logic / pages / roles /
statuses; no translation files; all config in Postgres; every new capability must be part of the
**constructor**, never a hardcoded one-off module.
