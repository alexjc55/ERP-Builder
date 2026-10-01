import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import {
  db,
  pool,
  entitiesTable,
  entityFieldsTable,
  entityRecordsTable,
  pagesTable,
  pageFieldsTable,
  pageRecordValuesTable,
  recordLinksTable,
  relationsTable,
} from "@workspace/db";
import {
  canExportPageFieldToFormula,
  canUseRecordPageFormulaContext,
  cloneFormulaDependencyInputs,
  createFormulaDependencyRequestCache,
  formulaSourcesOf,
  isExportedFormulaBasePageResource,
  legacyFormulaSourcesFromFields,
  localFormulaDependencyClosure,
  isDeniedFormulaProjection,
  markDeniedFormulaProjection,
  materializeVisibleEntityFormulas,
  materializeVisiblePageFormulas,
  mergeLinkedFormulaInputs,
  mergeLinkedFormulaInputsBatched,
} from "./formula-runtime";
import { linkedFormulaResourceKey, type LinkedFormulaPermissionContext } from "./linked-formula-resolver";

const managerLookup = {
  fieldKey: "order_project_manager",
  fieldType: "lookup",
  relationConfigJson: { relationId: 25, relatedFieldKey: "project_manager" },
};
const managerFormula = {
  fieldKey: "manager",
  fieldType: "function",
  formulaConfigJson: { expression: "{entity:72.order_project_manager}" },
};

function mockManagerFormulaDatabase(t: TestContext, recursive = false): void {
  t.mock.method(pool, "query", () => { throw new Error("Real database access forbidden in formula unit tests"); });
  t.mock.method(pool, "connect", () => { throw new Error("Real database connection forbidden in formula unit tests"); });
  t.mock.method(db, "select", (selection?: Record<string, unknown>) => ({
    from(table: unknown) {
      let rows: Record<string, unknown>[];
      if (table === entityFieldsTable) {
        rows = [{ ...managerLookup, entityId: 72 }];
        if (selection?.entityId) rows.push({ entityId: 74, fieldKey: "project_manager", fieldType: "user" });
      } else if (table === pageFieldsTable) {
        rows = [
          { pageId: 1024, fieldKey: "order_project_manager", fieldType: "number" },
          ...(recursive ? [{ ...managerFormula, pageId: 77 }] : []),
        ];
      } else if (table === entitiesTable) {
        rows = [{ id: 72, pageId: null }, { id: 74, pageId: null }];
      } else if (table === pagesTable) {
        rows = [{ id: 1024, mirrorEntityId: 72 }, { id: 77, mirrorEntityId: 72 }];
      } else if (table === relationsTable) {
        rows = [{ id: 25, sourceEntityId: 72, targetEntityId: 74 }];
      } else if (table === entityRecordsTable) {
        rows = selection?.archivedAt
          ? [{ id: 2, entityId: 74, values: { project_manager: 314 }, archivedAt: null }]
          : [{ id: 1, entityId: 72, values: {} }];
      } else if (table === recordLinksTable) {
        rows = [{ relationId: 25, sourceRecordId: 1, targetRecordId: 2 }];
      } else if (table === pageRecordValuesTable) {
        rows = [];
      } else {
        throw new Error("Unexpected table read in formula unit tests");
      }
      return {
        where() { return this; },
        limit() { return this; },
        then(resolve: (rows: Record<string, unknown>[]) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
    },
  }));
}

function managerPermissions(options: { deniedResource?: string; denyTargets?: boolean } = {}): LinkedFormulaPermissionContext {
  return {
    async authorizeResources(resources) {
      return new Set(resources.map(linkedFormulaResourceKey).filter((key) => key !== options.deniedResource));
    },
    async filterRows(scope) {
      return new Set(options.denyTargets && scope.entityId === 74 ? [] : scope.recordIds);
    },
  };
}

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

test("qualified entity lookup discovery ignores page shadows and foreign namespaces", () => {
  const sources = legacyFormulaSourcesFromFields([
    { ...managerLookup, scope: "entity" },
    {
      ...managerLookup,
      scope: "page",
      pageId: 1024,
      relationConfigJson: { relationId: 26, relatedFieldKey: "other_manager" },
    },
    {
      fieldKey: "copies", fieldType: "function", scope: "page", pageId: 1024,
      formulaConfigJson: {
        expression: "{entity:72.order_project_manager} + {order_project_manager} + {entity:74.order_project_manager} + {source:order_project_manager}",
      },
    },
  ], [
    { id: 25, sourceEntityId: 72, targetEntityId: 74 },
    { id: 26, sourceEntityId: 72, targetEntityId: 75 },
  ], 72);
  assert.deepEqual(sources, [{
    key: "entity:72.order_project_manager",
    kind: "aggregate",
    targetEntityId: 74,
    value: { scope: "entity", fieldKey: "project_manager" },
    join: { kind: "relation", relationId: 25, baseSide: "source" },
    aggregate: "min",
    limit: 1,
  }, {
    key: "order_project_manager",
    kind: "aggregate",
    targetEntityId: 75,
    value: { scope: "entity", fieldKey: "other_manager" },
    join: { kind: "relation", relationId: 26, baseSide: "source" },
    aggregate: "min",
    limit: 1,
  }]);
});

test("qualified and flat user lookup formulas resolve equally without serializing projections", async (t) => {
  mockManagerFormulaDatabase(t);
  const flatFormula = { ...managerFormula, fieldKey: "flat", formulaConfigJson: { expression: "{order_project_manager}" } };
  const fields = [managerLookup, managerFormula, flatFormula];
  const linkedInputs = await mergeLinkedFormulaInputs({
    entityId: 72,
    rows: [{ id: 1, values: {} }],
    fields,
    permissions: managerPermissions(),
    formulaOptions: { throwOnError: true },
  });
  assert.equal(linkedInputs.get(1)!["entity:72.order_project_manager"], 314);
  assert.equal(linkedInputs.get(1)!.order_project_manager, 314);
  const result = materializeVisibleEntityFormulas({
    entityId: 72, rows: [{ id: 1, values: {} }], fields,
    hidden: new Set(), linkedInputs,
  }).get(1)!;
  assert.deepEqual(result, { manager: 314, flat: 314 });
});

test("qualified entity lookup materializes beside a same-key page scalar, not through it", async (t) => {
  mockManagerFormulaDatabase(t);
  const entityFields = [managerLookup, managerFormula];
  const pageFields = [
    { fieldKey: "order_project_manager", fieldType: "number" },
    { ...managerFormula, fieldKey: "qualified_copy" },
    { ...managerFormula, fieldKey: "flat_copy", formulaConfigJson: { expression: "{order_project_manager}" } },
  ];
  const linkedInputs = await mergeLinkedFormulaInputs({
    entityId: 72, pageId: 1024, rows: [{ id: 1, values: {} }],
    fields: [...entityFields, ...pageFields], permissions: managerPermissions(),
    formulaOptions: { throwOnError: true },
  });
  assert.equal(linkedInputs.get(1)!["entity:72.order_project_manager"], 314);
  assert.equal("order_project_manager" in linkedInputs.get(1)!, false);
  const entityValues = materializeVisibleEntityFormulas({
    entityId: 72, pageId: 1024, rows: [{ id: 1, values: {} }], fields: entityFields,
    pageFields, pageValues: new Map([[1, { order_project_manager: 9 }]]),
    hidden: new Set(), hiddenPage: new Set(), linkedInputs,
  }).get(1)!;
  const pageValues = materializeVisiblePageFormulas({
    entityId: 72, pageId: 1024,
    rows: [{ id: 1, entityValues: {}, pageValues: { order_project_manager: 9 } }],
    entityFields, pageFields, hiddenEntity: new Set(), hiddenPage: new Set(), linkedInputs,
  }).get(1)!;
  assert.deepEqual(entityValues, { manager: 314 });
  assert.deepEqual(pageValues, { order_project_manager: 9, qualified_copy: 314, flat_copy: 9 });
});

test("qualified lookup source and target permissions deny transitive formula results", async (t) => {
  for (const boundary of ["lookup field", "target field", "target rows"] as const) {
    await t.test(boundary, async (t) => {
      mockManagerFormulaDatabase(t);
      const permissions = managerPermissions({
        deniedResource: boundary === "lookup field" ? "field:72:entity:order_project_manager"
          : boundary === "target field" ? "field:74:entity:project_manager" : undefined,
        denyTargets: boundary === "target rows",
      });
      const entityFields = [managerLookup, managerFormula];
      const pageFields = [
        { fieldKey: "order_project_manager", fieldType: "number" },
        { fieldKey: "chain", fieldType: "function", formulaConfigJson: { expression: "{entity:72.manager} + 1" } },
        { fieldKey: "flat_copy", fieldType: "function", formulaConfigJson: { expression: "{order_project_manager}" } },
      ];
      const linkedInputs = await mergeLinkedFormulaInputs({
        entityId: 72, pageId: 1024, rows: [{ id: 1, values: {} }],
        fields: [...entityFields, ...pageFields], permissions,
        formulaOptions: { throwOnError: true },
      });
      assert.equal(isDeniedFormulaProjection(linkedInputs.get(1), "entity:72.order_project_manager"), true);
      const result = materializeVisiblePageFormulas({
        entityId: 72, pageId: 1024,
        rows: [{ id: 1, entityValues: {}, pageValues: { order_project_manager: 9 } }],
        entityFields, pageFields,
        hiddenEntity: new Set(boundary === "lookup field" ? ["order_project_manager"] : []),
        hiddenPage: new Set(), linkedInputs,
      }).get(1)!;
      assert.equal(result.chain, null, "arithmetic cannot mask a denied lookup");
      assert.equal(isDeniedFormulaProjection(result, "chain"), true);
      assert.equal(result.flat_copy, 9, "entity denial must not taint the independent page scalar");
      assert.equal(isDeniedFormulaProjection(result, "flat_copy"), false);
    });
  }
});

test("a hidden entity lookup is not re-admitted by a same-key visible page field", () => {
  const values = materializeVisiblePageFormulas({
    entityId: 72, pageId: 1024,
    rows: [{ id: 1, entityValues: {}, pageValues: { order_project_manager: 9 } }],
    entityFields: [managerLookup],
    pageFields: [{ fieldKey: "order_project_manager", fieldType: "number" }, managerFormula],
    hiddenEntity: new Set(["order_project_manager"]), hiddenPage: new Set(),
    linkedInputs: new Map([[1, { "entity:72.order_project_manager": 314 }]]),
  }).get(1)!;
  assert.deepEqual(values, { order_project_manager: 9, manager: null });
});

test("flat page lookup denial does not taint an independent qualified entity lookup", () => {
  const linked = { order_project_manager: null, "entity:72.order_project_manager": 314 };
  markDeniedFormulaProjection(linked, "order_project_manager");
  for (const hiddenPage of [new Set<string>(), new Set(["order_project_manager"])]) {
    const result = materializeVisiblePageFormulas({
      entityId: 72, pageId: 1024,
      rows: [{ id: 1, entityValues: {}, pageValues: {} }],
      entityFields: [managerLookup],
      pageFields: [
        { ...managerLookup, relationConfigJson: { relationId: 26, relatedFieldKey: "other_manager" } },
        managerFormula,
        { fieldKey: "flat", fieldType: "function", formulaConfigJson: { expression: "{order_project_manager} + 1" } },
        { fieldKey: "page_qualified", fieldType: "function", formulaConfigJson: { expression: "{page:1024.order_project_manager} + 1" } },
      ],
      hiddenEntity: new Set(), hiddenPage, linkedInputs: new Map([[1, linked]]),
    }).get(1)!;
    assert.equal(result.manager, 314);
    assert.equal(isDeniedFormulaProjection(result, "manager"), false);
    assert.equal(result.flat, null);
    assert.equal(result.page_qualified, null);
    assert.equal(isDeniedFormulaProjection(result, "flat"), true);
    assert.equal(isDeniedFormulaProjection(result, "page_qualified"), true);
  }
});

test("native denied metadata retains its owning namespace beside a page scalar shadow", () => {
  const entityValues = { amount: null };
  markDeniedFormulaProjection(entityValues, "amount");
  const result = materializeVisiblePageFormulas({
    entityId: 72, pageId: 1024,
    rows: [{ id: 1, entityValues, pageValues: { amount: 9 } }],
    entityFields: [{ fieldKey: "amount", fieldType: "number" }],
    pageFields: [
      { fieldKey: "amount", fieldType: "number" },
      { fieldKey: "entity_copy", fieldType: "function", formulaConfigJson: { expression: "{entity:72.amount} + 1" } },
      { fieldKey: "page_copy", fieldType: "function", formulaConfigJson: { expression: "{amount}" } },
    ],
    hiddenEntity: new Set(), hiddenPage: new Set(),
  }).get(1)!;
  assert.equal(result.entity_copy, null);
  assert.equal(isDeniedFormulaProjection(result, "entity_copy"), true);
  assert.equal(result.page_copy, 9);
  assert.equal(isDeniedFormulaProjection(result, "page_copy"), false);
});

test("flat entity lookup denial propagates to qualified formula references", () => {
  const linked = { order_project_manager: null };
  markDeniedFormulaProjection(linked, "order_project_manager");
  const result = materializeVisibleEntityFormulas({
    entityId: 72, rows: [{ id: 1, values: {} }], fields: [managerLookup, managerFormula],
    hidden: new Set(), linkedInputs: new Map([[1, linked]]),
  }).get(1)!;
  assert.equal(result.manager, null);
  assert.equal(isDeniedFormulaProjection(result, "manager"), true);
});

test("recursive cross-page formulas discover qualified entity lookups in their local dependency closure", async (t) => {
  for (const denyTargets of [false, true]) {
    await t.test(denyTargets ? "denied target rows" : "allowed target rows", async (t) => {
      mockManagerFormulaDatabase(t, true);
      assert.deepEqual(localFormulaDependencyClosure(managerFormula, 72, 77, [managerLookup], [managerFormula]), [
        managerFormula, managerLookup,
      ]);
      const pageFields = [{
        fieldKey: "recursive", fieldType: "function",
        formulaConfigJson: { expression: "{page:77.manager} + 1" },
      }];
      const linkedInputs = await mergeLinkedFormulaInputs({
        entityId: 72, pageId: 1024, rows: [{ id: 1, values: {} }],
        fields: pageFields, permissions: managerPermissions({ denyTargets }),
        formulaOptions: { throwOnError: true },
      });
      assert.equal(linkedInputs.get(1)!["page:77.manager"], denyTargets ? null : 314);
      assert.equal(isDeniedFormulaProjection(linkedInputs.get(1), "page:77.manager"), denyTargets);
      const result = materializeVisiblePageFormulas({
        entityId: 72, pageId: 1024,
        rows: [{ id: 1, entityValues: {}, pageValues: {} }],
        entityFields: [managerLookup], pageFields,
        hiddenEntity: new Set(), hiddenPage: new Set(), linkedInputs,
      }).get(1)!;
      assert.deepEqual(result, { recursive: denyTargets ? null : 315 });
      assert.equal(isDeniedFormulaProjection(result, "recursive"), denyTargets);
    });
  }
});

test("only enabled, same-scope synthesized group links opt in to archived targets", () => {
  const relation = { id: 4, sourceEntityId: 7, targetEntityId: 8 };
  const link = {
    fieldKey: "order", fieldType: "relation", scope: "entity" as const,
    relationConfigJson: { relationId: 4, relatedFieldKey: "number" },
  };
  const formula = (enabled: boolean, scope: string, pageId?: number) => ({
    fieldKey: "once", fieldType: "function", scope: "entity" as const,
    formulaConfigJson: {
      expression: "{order}",
      groupResult: { enabled, fields: [{ scope, pageId, fieldKey: "order" }] },
    },
  });
  const group = legacyFormulaSourcesFromFields([link, formula(true, "entity")], [relation], 7);
  assert.equal(group[0].kind === "aggregate" && group[0].includeArchivedTargets, true);
  for (const field of [formula(false, "entity"), formula(true, "page", 22)]) {
    const sources = legacyFormulaSourcesFromFields([link, field], [relation], 7);
    assert.equal(sources[0].kind === "aggregate" && sources[0].includeArchivedTargets, undefined);
  }
  const pageLink = { ...link, scope: "page" as const, pageId: 22 };
  const page = legacyFormulaSourcesFromFields([pageLink, formula(true, "page", 22)], [relation], 7);
  assert.equal(page[0].kind === "aggregate" && page[0].includeArchivedTargets, true);
  const foreignPage = legacyFormulaSourcesFromFields([pageLink, formula(true, "page", 23)], [relation], 7);
  assert.equal(foreignPage[0].kind === "aggregate" && foreignPage[0].includeArchivedTargets, undefined);

  // The capability is transient server metadata, not a persisted formula option.
  const configured = formulaSourcesOf([{
    fieldType: "function",
    formulaConfigJson: { sources: [{
      ...group[0], key: "source:external", includeArchivedTargets: true,
    }] },
  }]);
  assert.equal(configured[0].kind === "aggregate" && configured[0].includeArchivedTargets, undefined);
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