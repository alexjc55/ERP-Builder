import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./EntityRecords.tsx", import.meta.url), "utf8");
const collaborationSource = readFileSync(
  new URL("../lib/useCollaboration.ts", import.meta.url),
  "utf8",
);

test("relation edits forward the server version into the next record save", () => {
  assert.match(
    source,
    /const handleRelationChanged = \(version\?: number\) => \{[\s\S]*?onRelationChanged\?\.\(version\);/,
  );
  assert.match(source, /editingVersionRef\.current = version;/);
  assert.match(
    source,
    /expectedVersion: editingVersionRef\.current \?\? editing\.version/,
  );
  assert.match(source, /draftVersionRef\.current = version;/);
  assert.match(
    source,
    /expectedVersion: draftVersionRef\.current \?\? draftVersion \?\? record\.version/,
  );
});

test("record save stays blocked while an edit-mode relation picker is open", () => {
  assert.match(
    source,
    /disabled=\{isPending \|\| dialogRelationEditing\}/,
  );
  assert.match(
    source,
    /disabled=\{submitting \|\| loading \|\| relationEditing\}/,
  );
  assert.match(
    source,
    /onEditingChange=\{\(open\) => onRelationEditingChange\?\.\(open\)\}/,
  );
  assert.match(
    source,
    /onOpenChange=\{\(nextOpen\) => \{[\s\S]*?if \(!nextOpen\) onEditingChange\(false\);/,
  );
  assert.match(
    source,
    /void choose\(newId\)\.finally\(\(\) => onEditingChange\(false\)\);/,
  );
});

test("same-entity page changes refetch permission-scoped rows and relation values", () => {
  assert.match(
    source,
    /\[entityId, queryKey, refreshTick, permPageId, recordsBootstrapReady\]/,
  );
  assert.match(
    source,
    /\[entityId, hasEntityRelationFields, recordIdsKey, entityRelationFieldsKey, refreshTick, manualProjectionRefreshTick, permPageId\]/,
  );
  assert.match(
    source,
    /\[mode, recordId, entityId, pageId, relTick\]/,
  );
  assert.match(
    source,
    /useLayoutEffect\(\(\) => \{[\s\S]*?pageValuesRequestIdRef\.current \+= 1;[\s\S]*?setRecords\(\[\]\);[\s\S]*?setPageRecordValues\(\[\]\);[\s\S]*?setEntityRelatedByRecord\(new Map\(\)\);[\s\S]*?\}, \[entityId, pageId, permPageId\]\);/,
  );
});

test("same-record-id mirror navigation invalidates stale page-value responses", () => {
  assert.match(source, /const requestId = \+\+pageValuesRequestIdRef\.current;/);
  assert.match(
    source,
    /if \(requestId !== pageValuesRequestIdRef\.current\) return;\s*setPageRecordValues\(result\);\s*setPageValuesHydration\(\{ status: "ready", key: requestScopeKey, error: null \}\);/,
  );
  assert.match(
    source,
    /return \(\) => \{\s*pageValuesRequestIdRef\.current \+= 1;\s*\};/,
  );
  assert.match(
    source,
    /\[pageId, recordIdsKey, pageValuesSchemaKey, refreshTick, manualProjectionRefreshTick, pageValuesRetryTick, hasLoadedRecords\]/,
  );
  assert.match(
    source,
    /pageValuesHydration\.key === pageValuesScopeKey[\s\S]*?pageRelatedHydrationKey === expectedPageRelatedHydrationKey[\s\S]*?entityRelatedHydrationKey === expectedEntityRelatedHydrationKey/,
  );
});

test("page-local write surfaces use hydration readiness and authoritative CAS", () => {
  assert.match(
    source,
    /const commitPageCell = [\s\S]*?if \(!guardPageLocalWrite\(\(\) => \{\}\)\) return;[\s\S]*?if \(pageState == null \|\| existingVersion == null\)/,
  );
  assert.match(source, /expectedVersions: \{ \[String\(pageId\)\]: existingVersion \}/);
  assert.match(source, /selectedBulkPageWriteBlocked/);
  assert.match(source, /role="alert"[\s\S]*?setPageValuesRetryTick\(\(tick\) => tick \+ 1\)/);
});

test("page-value refresh does not discard an active entity-cell editor", () => {
  const hydrationEffect = source.match(
    /useEffect\(\(\) => \{\s*const requestId = \+\+pageValuesRequestIdRef\.current;[\s\S]*?const relationFieldsKey = useMemo/,
  )?.[0];
  assert.ok(hydrationEffect);
  assert.doesNotMatch(hydrationEffect, /setEditingCell\(null\)/);
});

test("subscription gaps refresh only requests started before the active subscription", () => {
  assert.match(
    collaborationSource,
    /setConnectedPageId\(pageId\);[\s\S]*?setSubscriptionGeneration\([\s\S]*?setConnected\(true\);/,
  );
  assert.match(
    collaborationSource,
    /connected && connectedPageId === pageId[\s\S]*?`\$\{connectedPageId\}:\$\{subscriptionGeneration\}`/,
  );
  assert.match(source, /recordsLoadSubscriptionKeyRef\.current = requestSubscriptionKey;/);
  assert.match(
    source,
    /recordsLoadSubscriptionKeyRef\.current === subscriptionKey \|\|[\s\S]*?recordsLoadedSubscriptionKeyRef\.current === subscriptionKey/,
  );
  assert.match(source, /subscriptionRefreshKeyRef\.current = subscriptionKey;[\s\S]*?setRefreshTick/);
  assert.doesNotMatch(source, /collabWasConnectedRef/);
});

test("manual refresh cannot skip or invalidate a superseding scoped query", () => {
  assert.match(
    source,
    /const applied = await loadRecords\(\);[\s\S]*?if \(applied\) setManualProjectionRefreshTick/,
  );
  assert.doesNotMatch(source, /skipNextTickFetchRef/);
  assert.match(
    source,
    /\[pageId, hasRelationFields, recordIdsKey, relationFieldsKey, refreshTick, manualProjectionRefreshTick\]/,
  );
});

test("metadata bootstrap failures are terminal, visible, and retryable", () => {
  assert.match(source, /if \(viewInitialized \|\| viewsLoading \|\| viewsError\) return;/);
  assert.match(
    source,
    /if \(quickFilterSeeded \|\| fieldsError \|\| \(hasPage && pageFieldsError\)\) return;/,
  );
  assert.match(source, /data-testid="records-metadata-error"/);
  assert.match(source, /if \(viewsError\) void refetchViews\(\);/);
  assert.match(source, /if \(hasPage && pageFieldsError\) void refetchPageFields\(\);/);
});

test("successful empty metadata discards stale saved quick-filter keys", () => {
  assert.match(source, /if \(rawSeedFields && fieldsLoading\) return;/);
  assert.match(source, /if \(rawSeedPageFields && hasPage && pageFieldsLoading\) return;/);
  assert.doesNotMatch(source, /rawSeedFields && fields\.length === 0/);
  assert.doesNotMatch(source, /rawSeedPageFields && hasPage && pageFields\.length === 0/);
});

test("view and quick-filter bootstrap readiness is keyed to the exact route scope", () => {
  assert.match(source, /const initializationScopeKey = `\$\{entityId\}:\$\{pageId \?\? "none"\}`;/);
  assert.match(source, /const viewInitialized = viewInitializedScope === initializationScopeKey;/);
  assert.match(source, /const quickFilterSeeded = quickFilterSeededScope === initializationScopeKey;/);
  assert.doesNotMatch(source, /setViewInitialized\(false\)/);
  assert.doesNotMatch(source, /setQuickFilterSeeded\(false\)/);
});