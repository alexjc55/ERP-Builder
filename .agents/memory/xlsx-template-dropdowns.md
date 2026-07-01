---
name: XLSX import-template dropdowns
description: Why the import template is generated with exceljs (not SheetJS) and the rule that dropdown values must match the server's tolerant parser.
---

# Import template dropdowns (data validation)

The import feature downloads an `.xlsx` template. Select fields and the status
column carry real Excel dropdowns (list data-validation): allowed values live on
a hidden "Списки" sheet, each importable column's rows reference that range.

## Rule 1 — SheetJS community `xlsx` cannot WRITE data validation
The free `xlsx` (SheetJS) build silently drops dropdowns on write. Template
generation must use `exceljs`. Uploaded files are still *read* with `xlsx` (read
side is fine). **Why:** we tried to add dropdowns and there is no write API for
validation in the community package.
**How to apply:** any future "add a dropdown / lock a cell to a list / styled
export" work on the template uses exceljs; keep xlsx only for parsing uploads.

## Rule 2 — dropdown values must match the server's tolerant parser, in lockstep
Whatever string the template writes into a dropdown MUST be accepted by the
server when the filled file is imported. The server matchers are deliberately
tolerant and match by value OR any localized label:
- select values → `matchOption` (accepts option `value` or any ru/en/he label)
- status → `resolveStatusId` (accepts `statusKey` or any ru/en/he label)
**Why:** the client builds labels with the *current UI language* first
(`ml(...)`). If the server only accepts a ru-first name, an en/he user's template
generates labels the import then rejects. This was a real bug: `resolveStatusId`
originally matched only `statusKey` or ru→en→he `mlName`; it now matches any
localized label, mirroring `matchOption`.
**How to apply:** if you change how template dropdown labels are produced, or add
a new dropdown-backed column, verify the server matcher accepts exactly those
strings across all three locales — change both sides together.
