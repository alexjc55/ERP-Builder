---
name: Excel data consolidation workflow
description: How the user's Excel data is being consolidated into the local DB, and constraints for the remaining stages (logistics etc.)
---

Ongoing multi-stage import of the user's "Управление проектами 2026" Google-Sheets export into the ERP.

**Rules agreed with the user:**
- All data changes are made in the LOCAL Replit DB; at the end a dump will be produced and loaded onto the external prod server (prod is frozen — no SQL scripts for prod anymore).
- Before ANY data load, present a column→field mapping plan and get explicit confirmation.
- Conflict policy: non-empty file cell wins; empty file cell keeps DB value.
- Archive rule: unarchive everything, then archive only rows/orders where «Архивация» = «Подано 100%»; orders with mixed rows stay active.

**Key mechanics (validated):**
- Sheet «הזמנות 2026»: 1 row = изделие (item); order-level values are the first non-empty across the order's rows. Composite order numbers "A//B" normalize to A.
- Item lookups on entity 72 are writeThrough projections of order (74) fields via relation 25 — write order fields, items follow.
- «Статус в эпоколь» is a page-local select (page_record_values, page 77, key status_epokol).
- File/link columns store `{kind:"link", url}` in file fields; hyperlinks extracted from cells via exceljs (values may be formula objects — use .result/.text; dates → Date objects).
- Scripts: exceljs only resolves from artifacts/erp-platform; `pg` only from lib/db — extract to /tmp/rows.json in one, apply transactionally in the other. Always --dry first.
- Name→user matching must strip quote variants (' " ״ ׳); PM pairs map to second name (רינה/ברוך→ברוך id2, ארינה/יבגניי→יבגניי id20, ולדימיר→46).

**Logistics load (done):** rows join to items via the shared UUID column (col «ID») between the two Excel files — when a cell has a hyperlink, `value.text` must be extracted (String() of the cell object silently becomes "[object Object]" and breaks matching). Deliveries were rebuilt per order from direction cols: «про-во - эпоколь» → two legs (leg1 Производство-Покрасочная + Покрасчик=Эпоколь + status 58, leg2 Покрасочная-Объект with file status), other dirs → one leg from part2-fallback-part1. Typo maps: Емит 1801/1802→1800, יצאה/יאציה לישראל→יצאיה לישראל, %=fraction×100.

**Open/pending:**
- Logistics file (הובלות/נהג/даты доставки/התקנה columns) not yet delivered — separate confirmed mapping needed.
- תל חי 9 duplicate projects (169/263, different זוארץ clients) — awaiting user decision.
- 39 DB items had no match in the file (possible renamed duplicates); 6 mixed-archive orders: 3287, 3325, 3462, 3463, 3744, 3969.
- «Оплата SD» column has no extractable values (Google formula residue) — never loaded.
