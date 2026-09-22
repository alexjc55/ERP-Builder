# Outgoing automation webhooks

Automations run as the system. A webhook is an administrator-configured export,
not a viewer-permission API. The receiver must be trusted to receive the entity's
data. Existing SSRF checks and webhook delivery behavior are unchanged.

## Contract

`includeRecord: false` (or absent) sends **exactly**
`{"entityId":12,"recordId":45}`. No version or other properties are added.

With `includeRecord: true`, schema version 2 adds display projections while
retaining `entityId`, `recordId`, `statusId` and the legacy `values` map. Values
are reloaded at the webhook action, so preceding automation mutations are visible.
Legacy entity-source relation/lookup entries retain their string-array shape;
they are not replaced by localized labels.

Example (illustrative IDs):

```json
{
  "entityId": 12,
  "recordId": 45,
  "statusId": null,
  "values": {"owner": 7, "priority": "high"},
  "schemaVersion": 2,
  "language": "en",
  "pageId": null,
  "fields": [
    {
      "key": "entity:12.owner",
      "fieldKey": "owner",
      "entityId": 12,
      "pageId": null,
      "name": "Owner",
      "nameJson": {"en": "Owner"},
      "type": "user",
      "rawValue": 7,
      "resolvedValue": {"id": 7, "name": "Ada Lovelace"},
      "displayValue": "Ada Lovelace"
    },
    {
      "key": "entity:12.priority",
      "fieldKey": "priority",
      "entityId": 12,
      "pageId": null,
      "name": "Priority",
      "nameJson": {"en": "Priority"},
      "type": "select",
      "rawValue": "high",
      "resolvedValue": {"id": "high", "labelJson": {"en": "High"}, "label": "High"},
      "displayValue": "High"
    }
  ]
}
```

`fields` contains active entity fields and page-local fields. A page field has a
`page:123.field_key` key and `pageId: 123`; collisions with entity fields and
other pages are impossible. The optional action `pageId` must identify a mirror
of the automation entity. Without it, all applicable mirror-page local fields
are included, each in its own namespace; entity formulas have no arbitrary
implicit page context.

`language` accepts `ru` (default), `en`, or `he`. Names and select labels prefer
that language, then Russian, English, Hebrew. Select IDs are stable stored
values, never translated. User projections contain only ID and display name
(name falls back to email as in the UI); unavailable users retain their ID.

Formula `rawValue` is null, and `resolvedValue` is the evaluated scalar or null,
not a number coercion. Shared runtime evaluation supports formula chains,
qualified entity/page sources and linked sources. Expressions, formula source
configurations and permissions are not included. Numeric precision and affixes
are display-only; booleans remain booleans. Dates retain their stored ISO value;
display uses the UI's day-first format and, for timestamps, the application
calendar timezone rather than an unknown receiver/browser timezone. Grouped
formula display uses deterministic first-record winners across active records
in the system-authorized entity, not an initiating user's filtered view.

Relations/lookups have null `rawValue` and an array `resolvedValue`. Each item
contains `relationId`, `linkId`, `entityId`, `recordId`, `pageId`, the nested
`field` projection, `resolvedValue`, and `displayValue`. Nested users, select
labels, formulas, page-local lookups and further links use the same projection
rules. Missing target fields report `missing_projection_field`; recursive field
cycles report `projection_cycle_or_depth_limit`. Ordinary absent values are
null, displayed as `—`.

## File links and deployment origin

Resolved files include only kind, name and URL (plus Drive file ID or
`requiresAuthentication: true` for local/server storage). Drive uses its stored
`webViewLink`, otherwise `https://drive.google.com/file/d/ID/view`. External
links retain their HTTP(S) URL. Local `/local/...` and `/objects/...` paths use
the existing protected `/api/storage` serving route.

The scheduler has no HTTP request origin, and this application does not persist
a canonical origin for automation delivery. Configure **Application origin for
local files** (`baseUrl`, e.g. your real `https://erp.company.example`) in the
webhook action, or set server `WEBHOOK_ORIGIN`. No deployment URL is guessed.
Without either, a relative file URL fails the webhook action explicitly rather
than sending an unusable relative link. Origins with embedded credentials or
non-HTTP(S) schemes are rejected. Links do not embed authentication tokens,
change file permissions, or make files public; receivers still need authorized
access to protected local storage or Drive.

## Bounds and operations

Projection traversal is batched and bounded to 8 relation levels, 500 records,
5,000 field definitions, 5,000 links per batch and a 2 MB serialized payload.
Grouped formulas allow at most 500 candidate records per entity. Exceeding a
bound fails delivery explicitly; data is not silently truncated.

No SQL migration is required: optional action properties are stored in the
existing action JSON. No production data or translations are changed by this
implementation. RU/EN/HE helper translations are in the existing translation
seed source and follow the project's normal deployment process.

Focused tests:

- `automation-webhook-display.test.ts`: pure display, typed formulas and file URLs.
- `automation-webhook-payload.db.test.ts`: opt in with `RUN_WEBHOOK_DB_TESTS=1`
  against an isolated development/test database; inserts and removes fixtures.
  Never run the fixture suite against production.