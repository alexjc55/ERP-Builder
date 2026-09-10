import assert from "node:assert/strict";
import test from "node:test";
import {
  canExportPageFieldToFormula,
  canUseRecordPageFormulaContext,
  cloneFormulaDependencyInputs,
  createFormulaDependencyRequestCache,
  formulaSourcesOf,
  isExportedFormulaBasePageResource,
  legacyFormulaSourcesFromFields,
  isDeniedFormulaProjection,
  markDeniedFormulaProjection,
  materializeVisibleEntityFormulas,
  materializeVisiblePageFormulas,
  mergeLinkedFormulaInputs,
  mergeLinkedFormulaInputsBatched,
} from "./formula-runtime";
import type { LinkedFormulaPermissionContext } from "./linked-formula-resolver";

test("formula dependency reuse is request-owned, permission-partitioned, and clone-safe", async () => {
  const allowAll: LinkedFormulaPermissionContext = {
    async authorizeResources(resources) {
      return new Set(resources.map((resource) =>
        resource.kind === "entity"
          ? `entity:${resource.entityId}`
          : resource.kind === "page"
            ? `page:${resource.entityId}:${resource.pageId}`
            : resource.scope === "entity"
              ? `field:${resource.entityId}:entity:${resource.fieldKey}`
              : `field:${resource.entityId}:page:${resource.pageId}:${resource.fieldKey}`,
      ));
    },
    async filterRows(scope) {
      return new Set(scope.recordIds);
    },
  };
  const otherIdentity: LinkedFormulaPermissionContext = {
    ...allowAll,
    async filterRows(scope) {
      return new Set(scope.recordIds);
    },
  };
  const requestCache = createFormulaDependencyRequestCache();
  const common = {
    entityId: 72,
    rows: [{ id: 1, values: { amount: 5, nested: { left: 1, right: 2 } } }],
    fields: [] as const,
  };

  const first = await mergeLinkedFormulaInputs({
    ...common,
    permissions: allowAll,
    requestCache,
  });
  first.get(1)!.amount = 99;
  (first.get(1)!.nested as { left: number }).left = 99;
  const second = await mergeLinkedFormulaInputs({
    ...common,
    permissions: allowAll,
    requestCache,
  });

  assert.equal(second.get(1)!.amount, 5, "cached maps are cloned before each formula pass");
  assert.deepEqual(
    second.get(1)!.nested,
    { left: 1, right: 2 },
    "nested cached JSON is cloned before each formula pass",
  );
  await mergeLinkedFormulaInputs({
    ...common,
    rows: [{ id: 1, values: { nested: { right: 2, left: 1 }, amount: 5 } }],
    permissions: allowAll,
    requestCache,
  });
  assert.equal(requestCache.byPermissionContext.get(allowAll)?.size, 1);
  await mergeLinkedFormulaInputs({
    ...common,
    permissions: otherIdentity,
    requestCache,
  });
  assert.equal(requestCache.byPermissionContext.get(otherIdentity)?.size, 1);
  assert.notEqual(
    requestCache.byPermissionContext.get(allowAll),
    requestCache.byPermissionContext.get(otherIdentity),
  );
});

test("formula dependency clones preserve denied metadata at every JSON depth", () => {
  const nested = { blockedChild: "secret", allowedChild: "visible" };
  const values = { blocked: "secret", nested };
  markDeniedFormulaProjection(values, "blocked");
  markDeniedFormulaProjection(nested, "blockedChild");

  const cloned = cloneFormulaDependencyInputs(new Map([[1, values]])).get(1)!;
  const clonedNested = cloned.nested as Record<string, unknown>;
  assert.equal(isDeniedFormulaProjection(cloned, "blocked"), true);
  assert.equal(isDeniedFormulaProjection(clonedNested, "blockedChild"), true);
  clonedNested.allowedChild = "changed";
  assert.equal(nested.allowedChild, "visible");
});

test("cross-page formula export is field-wide and preserves ordinary read boundaries", () => {
  const base = {
    ordinaryFieldAccess: "view" as const,
    recordView: true,
  };
  assert.equal(canExportPageFieldToFormula({ ...base, allowFormulaExport: undefined }), false);
  assert.equal(canExportPageFieldToFormula({ ...base, allowFormulaExport: false }), false);
  assert.equal(canExportPageFieldToFormula({ ...base, allowFormulaExport: true }), true);
  assert.equal(canExportPageFieldToFormula({
    ...base,
    allowFormulaExport: true,
    ordinaryFieldAccess: "hidden",
  }), false);
  assert.equal(canExportPageFieldToFormula({
    ...base,
    allowFormulaExport: true,
    recordView: false,
  }), false);
});

test("exported formula context bypasses only its exact canonical base-page resource", () => {
  const context = { entityId: 72, pageId: 119 };
  assert.equal(isExportedFormulaBasePageResource(
    { kind: "page", entityId: 72, pageId: 119 },
    context,
  ), true);
  assert.equal(isExportedFormulaBasePageResource(
    { kind: "page", entityId: 72, pageId: 120 },
    context,
  ), false);
  assert.equal(isExportedFormulaBasePageResource(
    { kind: "page", entityId: 74, pageId: 119 },
    context,
  ), false);
  assert.equal(isExportedFormulaBasePageResource(
    { kind: "field", entityId: 72, scope: "entity", fieldKey: "entry_date" },
    context,
  ), false);
  assert.equal(isExportedFormulaBasePageResource(
    { kind: "field", entityId: 72, scope: "page", pageId: 119, fieldKey: "dney_proizvodstva" },
    context,
  ), false);
  assert.equal(isExportedFormulaBasePageResource(
    { kind: "page", entityId: 72, pageId: 119 },
    undefined,
  ), false);
});

test("qualified page references become permission-aware page-local sources automatically", () => {
  const fields = [{
    fieldKey: "epokol_ready",
    fieldType: "function",
    formulaConfigJson: {
      expression: "{page:77.production_finish_date}",
    },
  }];

  assert.deepEqual(formulaSourcesOf(fields), [{
    kind: "pageLocal",
    key: "page:77.production_finish_date",
    pageId: 77,
    fieldKey: "production_finish_date",
  }]);

  const values = materializeVisiblePageFormulas({
    entityId: 72,
    pageId: 90,
    rows: [{ id: 4164, entityValues: {}, pageValues: {} }],
    entityFields: [],
    pageFields: fields,
    hiddenEntity: new Set(),
    hiddenPage: new Set(),
    linkedInputs: new Map([[4164, {
      "page:77.production_finish_date": "2026-08-19",
    }]]),
  }).get(4164)!;

  assert.equal(values.epokol_ready, "2026-08-19");
});

test("legacy relation and lookup references become linked sources, with page shadowing", () => {
  const sources = legacyFormulaSourcesFromFields([
    {
      fieldKey: "entry_date",
      fieldType: "lookup",
      scope: "entity",
      relationConfigJson: { relationId: 4, relatedFieldKey: "date" },
    },
    {
      fieldKey: "entry_date",
      fieldType: "lookup",
      scope: "page",
      pageId: 22,
      relationConfigJson: { relationId: 5, relatedFieldKey: "page_date", relatedPageId: 31 },
    },
    { fieldKey: "age", fieldType: "function", scope: "entity", formulaConfigJson: { expression: "daysSince({entry_date})" } },
  ], [
    { id: 4, sourceEntityId: 7, targetEntityId: 8 },
    { id: 5, sourceEntityId: 7, targetEntityId: 9 },
  ], 7);

  assert.deepEqual(sources, [{
    key: "entry_date",
    kind: "aggregate",
    targetEntityId: 9,
    targetPageId: 31,
    value: { scope: "page", pageId: 31, fieldKey: "page_date" },
    join: { kind: "relation", relationId: 5, baseSide: "source" },
    aggregate: "min",
    limit: 1,
  }]);
});

test("legacy source discovery accepts the pre-extracted keys used by the DB metadata path", () => {
  const sources = legacyFormulaSourcesFromFields([
    {
      fieldKey: "entry_date",
      fieldType: "lookup",
      scope: "entity",
      relationConfigJson: { relationId: 25, relatedFieldKey: "production_date" },
    },
  ], [
    { id: 25, sourceEntityId: 72, targetEntityId: 74 },
  ], 72, ["entry_date", "material_release_date"]);

  assert.deepEqual(sources, [{
    key: "entry_date",
    kind: "aggregate",
    targetEntityId: 74,
    value: { scope: "entity", fieldKey: "production_date" },
    join: { kind: "relation", relationId: 25, baseSide: "source" },
    aggregate: "min",
    limit: 1,
  }]);
});

test("legacy relation source inputs feed visible formula chains but never serialize", () => {
  const values = materializeVisibleEntityFormulas({
    entityId: 7,
    rows: [{ id: 1, values: {} }],
    linkedInputs: new Map([[1, { entry_date: "2025-01-01" }]]),
    fields: [
      { fieldKey: "entry_date", fieldType: "lookup", relationConfigJson: { relationId: 4, relatedFieldKey: "date" } },
      { fieldKey: "days", fieldType: "function", formulaConfigJson: { expression: "daysSince({entry_date})" } },
      { fieldKey: "chain", fieldType: "function", formulaConfigJson: { expression: "{days} + 1" } },
    ],
    hidden: new Set(),
    formulaOptions: { now: new Date("2025-01-15T12:00:00Z") },
  }).get(1)!;
  assert.equal(values.days, 14);
  assert.equal(values.chain, 15);
  assert.equal("entry_date" in values, false);
});

test("a page lookup shadow keeps the entity scalar and uses the projected page value", () => {
  const entityFields = [
    { fieldKey: "entry_date", fieldType: "date", formulaConfigJson: {} },
    { fieldKey: "entity_copy", fieldType: "function", formulaConfigJson: { expression: "{entity:7.entry_date}" } },
  ];
  const pageFields = [
    {
      fieldKey: "entry_date",
      fieldType: "lookup",
      relationConfigJson: { relationId: 4, relatedFieldKey: "date" },
      formulaConfigJson: {},
    },
    { fieldKey: "page_copy", fieldType: "function", formulaConfigJson: { expression: "{entry_date}" } },
  ];
  const linkedInputs = new Map([[1, { entry_date: "2026-02-01" }]]);

  const entityValues = materializeVisibleEntityFormulas({
    entityId: 7,
    pageId: 22,
    rows: [{ id: 1, values: { entry_date: "2026-01-01" } }],
    fields: entityFields,
    pageFields,
    pageValues: new Map([[1, {}]]),
    hidden: new Set(),
    hiddenPage: new Set(),
    linkedInputs,
  }).get(1)!;
  assert.equal(entityValues.entry_date, "2026-01-01");
  assert.equal(entityValues.entity_copy, "2026-01-01");

  const pageValues = materializeVisiblePageFormulas({
    entityId: 7,
    pageId: 22,
    rows: [{ id: 1, entityValues: { entry_date: "2026-01-01" }, pageValues: {} }],
    entityFields,
    pageFields,
    hiddenEntity: new Set(),
    hiddenPage: new Set(),
    linkedInputs,
  }).get(1)!;
  assert.equal(pageValues.page_copy, "2026-02-01");
  assert.equal("entry_date" in pageValues, false);
});

test("page formula context requires page access and canonical entity ownership", () => {
  const entityAuthorized = {
    superAdmin: false,
    pageIds: [] as number[],
  };
  const entityView = { view: true, create: true, update: true, delete: false };

  // Entity record access by itself must not expose an inaccessible page.
  assert.equal(canUseRecordPageFormulaContext({
    permissions: entityAuthorized,
    entityId: 7,
    pageId: 22,
    pageEntityId: 7,
    recordPermission: entityView,
  }), false);

  // Access to a page of another entity must not make it a valid context.
  assert.equal(canUseRecordPageFormulaContext({
    permissions: { ...entityAuthorized, pageIds: [22] },
    entityId: 7,
    pageId: 22,
    pageEntityId: 8,
    recordPermission: entityView,
  }), false);

  // A page belonging to the entity, present in pageIds, with page-aware view
  // permission remains a valid formula context.
  assert.equal(canUseRecordPageFormulaContext({
    permissions: { ...entityAuthorized, pageIds: [22] },
    entityId: 7,
    pageId: 22,
    pageEntityId: 7,
    recordPermission: entityView,
  }), true);
});

test("batched linked inputs preserve every row in one merged full-set map", async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    values: { value: index },
  }));
  const result = await mergeLinkedFormulaInputsBatched({
    entityId: 1,
    rows,
    fields: [],
    permissions: {
      authorizeResources: async () => new Set<string>(),
      filterRows: async () => new Set<number>(),
    },
  }, 2);
  assert.deepEqual([...result], rows.map((row) => [row.id, row.values]));
});

test("visible linked-source formulas are materialized without returning source tokens or hidden formulas", () => {
  const values = materializeVisibleEntityFormulas({
    entityId: 7,
    rows: [{ id: 11, values: { amount: 1.25 } }],
    linkedInputs: new Map([[11, { amount: 1.25, "source:linked_total": 4 }]]),
    fields: [
      { fieldKey: "amount", fieldType: "number", formulaConfigJson: {} },
      {
        fieldKey: "linked_total",
        fieldType: "function",
        formulaConfigJson: {
          expression: "{amount} * {source:linked_total}",
          decimals: 2,
          sources: [{
            kind: "aggregate",
            key: "source:linked_total",
            targetEntityId: 8,
            join: {
              kind: "equality",
              on: [{
                base: { scope: "entity", fieldKey: "order_no" },
                target: { scope: "entity", fieldKey: "order_no" },
              }],
            },
            value: { scope: "entity", fieldKey: "cost" },
            aggregate: "sum",
          }],
        },
      },
      {
        fieldKey: "qualified_chain",
        fieldType: "function",
        formulaConfigJson: { expression: "{entity:7.linked_total} + 0.5" },
      },
      {
        fieldKey: "secret_formula",
        fieldType: "function",
        formulaConfigJson: { expression: "{source:linked_total}" },
      },
    ],
    hidden: new Set(["secret_formula"]),
  });

  const result = values.get(11)!;
  assert.equal(result.linked_total, 5);
  assert.equal(result.qualified_chain, 5.5);
  assert.equal("secret_formula" in result, false);
  assert.equal("source:linked_total" in result, false);
});

test("a visible formula cannot resolve a hidden formula alias or its resolver input", () => {
  const values = materializeVisibleEntityFormulas({
    entityId: 7,
    rows: [{ id: 1, values: {} }],
    linkedInputs: new Map([[1, { "source:secret": 41 }]]),
    fields: [
      {
        fieldKey: "public_formula",
        fieldType: "function",
        formulaConfigJson: { expression: "{secret_formula}" },
      },
      {
        fieldKey: "secret_formula",
        fieldType: "function",
        formulaConfigJson: {
          expression: "{source:secret}",
          sources: [{ kind: "pageLocal", key: "source:secret", pageId: 22, fieldKey: "secret" }],
        },
      },
    ],
    hidden: new Set(["secret_formula"]),
  }).get(1)!;
  assert.equal(values.public_formula, null);
  assert.equal("secret_formula" in values, false);
  assert.equal("source:secret" in values, false);
});

test("viewer projection makes hidden stored entity fields neutral", () => {
  const values = materializeVisibleEntityFormulas({
    entityId: 7,
    rows: [{ id: 1, values: { hidden_salary: 9000 } }],
    fields: [
      { fieldKey: "public_formula", fieldType: "function", formulaConfigJson: { expression: "{hidden_salary}" } },
      { fieldKey: "hidden_salary", fieldType: "number", formulaConfigJson: {} },
    ],
    hidden: new Set(["hidden_salary"]),
  }).get(1)!;
  assert.equal(values.public_formula, null);
  assert.equal("hidden_salary" in values, false);
});

test("viewer projection makes hidden stored page fields neutral", () => {
  const values = materializeVisiblePageFormulas({
    entityId: 7,
    pageId: 22,
    rows: [{ id: 1, entityValues: {}, pageValues: { hidden_margin: 73 } }],
    entityFields: [],
    pageFields: [
      { fieldKey: "public_formula", fieldType: "function", formulaConfigJson: { expression: "{page:22.hidden_margin}" } },
      { fieldKey: "hidden_margin", fieldType: "number", formulaConfigJson: {} },
    ],
    hiddenEntity: new Set(),
    hiddenPage: new Set(["hidden_margin"]),
  }).get(1)!;
  assert.equal(values.public_formula, null);
  assert.equal("hidden_margin" in values, false);
});

test("entity formulas cannot read hidden page values", () => {
  const values = materializeVisibleEntityFormulas({
    entityId: 7,
    pageId: 22,
    rows: [{ id: 1, values: {} }],
    pageValues: new Map([[1, { hidden_margin: 73 }]]),
    fields: [
      {
        fieldKey: "public_formula",
        fieldType: "function",
        formulaConfigJson: { expression: "{page:22.hidden_margin}" },
      },
    ],
    pageFields: [
      { fieldKey: "hidden_margin", fieldType: "number", formulaConfigJson: {} },
    ],
    hidden: new Set(),
    hiddenPage: new Set(["hidden_margin"]),
  }).get(1)!;
  assert.equal(values.public_formula, null);
  assert.equal("hidden_margin" in values, false);
});

test("entity formulas materialize page-qualified values and page formula chains", () => {
  const values = materializeVisibleEntityFormulas({
    entityId: 7,
    pageId: 22,
    rows: [{ id: 11, values: { amount: 2 } }],
    linkedInputs: new Map([[11, { amount: 2, "source:private": 99 }]]),
    pageValues: new Map([[11, { multiplier: 3, "source:private": 99 }]]),
    fields: [
      { fieldKey: "amount", fieldType: "number", formulaConfigJson: {} },
      {
      fieldKey: "page_based",
      fieldType: "function",
      formulaConfigJson: {
        expression: "{page:22.page_total} + {amount}",
        sources: [{ kind: "pageLocal", key: "source:private", pageId: 22, fieldKey: "private" }],
      },
    }],
    pageFields: [
      { fieldKey: "multiplier", fieldType: "number", formulaConfigJson: {} },
      {
      fieldKey: "page_total",
      fieldType: "function",
      formulaConfigJson: { expression: "{page:22.multiplier} * 4" },
    }],
    hidden: new Set(),
    hiddenPage: new Set(),
  }).get(11)!;

  assert.equal(values.page_based, 14);
  assert.equal("source:private" in values, false);
});

test("computed page sources remain lazy and cycles fail closed", () => {
  const values = materializeVisiblePageFormulas({
    entityId: 7,
    pageId: 81,
    rows: [{ id: 1, entityValues: {}, pageValues: { base: 3 } }],
    entityFields: [],
    pageFields: [
      { fieldKey: "base", fieldType: "number", formulaConfigJson: {} },
      { fieldKey: "stoimost_montazha", fieldType: "function", formulaConfigJson: { expression: "{base} * 2" } },
      { fieldKey: "chain", fieldType: "function", formulaConfigJson: { expression: "{stoimost_montazha} + 1" } },
      { fieldKey: "cycle_a", fieldType: "function", formulaConfigJson: { expression: "{cycle_b}" } },
      { fieldKey: "cycle_b", fieldType: "function", formulaConfigJson: { expression: "{cycle_a}" } },
    ],
    hiddenEntity: new Set(),
    hiddenPage: new Set(),
  }).get(1)!;
  assert.equal(values.stoimost_montazha, 6);
  assert.equal(values.chain, 7);
  assert.equal(values.cycle_a, null);
  assert.equal(values.cycle_b, null);
});

test("a same-key page field cannot re-admit a hidden entity value", () => {
  const values = materializeVisiblePageFormulas({
    entityId: 7,
    pageId: 81,
    rows: [{
      id: 1,
      entityValues: { secret: 41 },
      pageValues: { secret: 1 },
    }],
    entityFields: [
      { fieldKey: "secret", fieldType: "number", formulaConfigJson: {} },
    ],
    pageFields: [
      { fieldKey: "secret", fieldType: "number", formulaConfigJson: {} },
      {
        fieldKey: "leak_check",
        fieldType: "function",
        formulaConfigJson: { expression: "{entity:7.secret}" },
      },
    ],
    hiddenEntity: new Set(["secret"]),
    hiddenPage: new Set(),
    linkedInputs: new Map([[1, { secret: 41 }]]),
  }).get(1)!;

  assert.equal(values.secret, 1);
  assert.equal(values.leak_check, null);
});