import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./EntityRecords.tsx", import.meta.url), "utf8");

test("records publish only after dependent projection requests have started", () => {
  assert.match(
    source,
    /launchPageValuesHydration\(res\.data, generationForFetch\);[\s\S]*?launchPageRelatedHydration\(res\.data, generationForFetch\);[\s\S]*?launchEntityRelatedHydration\(res\.data, generationForFetch\);[\s\S]*?setRecords\(res\.data\);/,
  );
  assert.match(source, /if \(pageValuesStartedRequestRef\.current === requestKey\) return;/);
  assert.match(source, /if \(pageRelatedStartedRequestRef\.current === requestKey\) return;/);
  assert.match(source, /if \(entityRelatedStartedRequestRef\.current === requestKey\) return;/);
});

test("first records response mounts rows without waiting for projections", () => {
  assert.match(source, /\{!hasLoadedRecords \? \(/);
  assert.doesNotMatch(source, /hasPresentedHydratedRows/);
  assert.match(source, /data-testid="record-projection-state"/);
  assert.match(source, /data-state=\{state\}/);
});

test("partial projection data is never presented as an empty formula or relation", () => {
  assert.match(
    source,
    /const rowProjectionsPending = pageValuesPending \|\| pageRelationsPending \|\| entityRelationsPending;/,
  );
  assert.match(
    source,
    /const formulaValues = rowProjectionsReady\s*\? buildFormulaScope\(allValues, formulaFieldDefs, formulaOptions\)\s*: allValues;/,
  );
  assert.match(source, /entityRelationsPending \|\| entityRelationsUnavailable/);
  assert.match(source, /pageRelationsPending \|\| pageRelationsUnavailable/);
  assert.match(source, /pageValuesPending \|\| pageValuesUnavailable/);
});

test("manual refresh reuses the records generation without a duplicate projection tick", () => {
  assert.match(source, /const generationForFetch = `\$\{requestId\}`;/);
  assert.match(source, /await loadRecords\(true\);/);
  assert.doesNotMatch(source, /setManualProjectionRefreshTick/);
  assert.doesNotMatch(source, /manualProjectionRefreshTick \+ \(manual \? 1 : 0\)/);
});

test("page value editors survive pending projection state while their CAS guard remains active", () => {
  assert.match(
    source,
    /if \(pf\.fieldType === "page_ref"\) \{[\s\S]*?if \(isEditingThis\) \{[\s\S]*?<InlineCellEditor[\s\S]*?if \(pageValuesPending \|\| pageValuesUnavailable\)/,
  );
  assert.match(
    source,
    /const pageFieldAsField =[\s\S]*?if \(isEditingThis\) \{[\s\S]*?<InlineCellEditor[\s\S]*?if \(pageValuesPending \|\| pageValuesUnavailable\)/,
  );
  assert.match(source, /if \(!guardPageLocalWrite\(\(\) => \{\}\)\) return;/);
});

test("a rejected pending page-value commit leaves the same draft armed for one accepted retry", () => {
  assert.match(
    source,
    /const commitPageCell = \(record: EntityRecord, field: PageField, raw: CellValue\): boolean => \{[\s\S]*?if \(!guardPageLocalWrite\(\(\) => \{\}\)\) return false;/,
  );
  assert.match(
    source,
    /const attempt = attemptInlineCommit\(committedRef, onCommit, raw\);\s*if \(attempt === "rejected"\) \{[\s\S]*?setDraft\(raw\);[\s\S]*?return;\s*\}[\s\S]*?if \(attempt === "already-committed"\) return;/,
  );
  assert.equal(
    (source.match(/onCommit=\{\(raw\) => commitPageCell\(record, pf, raw\)\}/g) ?? []).length,
    2,
    "both page and page_ref InlineCellEditors must propagate write acceptance",
  );
});

test("rejected picker selections retain their draft instead of treating portal close as cancel", () => {
  assert.match(
    source,
    /if \(attempt === "rejected"\) \{\s*retryPendingRef\.current = true;\s*setRetryPending\(true\);\s*setDraft\(raw\);\s*return;/,
  );
  assert.match(
    source,
    /if \(!committed && !committedRef\.current && !retryPendingRef\.current\) onCancel\(\);/,
  );
  assert.equal(
    (source.match(/if \(!o && !committedRef\.current && !retryPendingRef\.current\) onCancel\(\);/g) ?? []).length,
    2,
    "both select pickers must suppress close-cancel while a retry is pending",
  );
  assert.match(source, /value=\{typeof draft === "string" \? draft : draft == null \? "" : String\(draft\)\}/);
  assert.match(source, /<InlineFileEditor[\s\S]*?onCommit=\{commitOnce\}[\s\S]*?onCancel=\{onCancel\}/);
  assert.match(source, /const cancelPickerOnEscape = \(event: ReactKeyboardEvent\) => \{[\s\S]*?cancelRetry\(\);/);
  assert.match(source, /const \[retryPending, setRetryPending\] = useState\(false\);/);
  assert.match(source, /data-testid="inline-picker-retry-controls"/);
  assert.equal(
    (source.match(/\{retryPickerControls\}/g) ?? []).length,
    4,
    "one shared retry/cancel control must be present for user, dependent, select, and list-percent pickers",
  );
});

test("totals and empty states wait for the exact query response", () => {
  assert.match(source, /const totalsAuthoritative = totalsResultKey === recordsResultKey;/);
  assert.match(source, /setTotalsResultKey\(null\);/);
  assert.match(source, /setTotalsResultKey\(recordsResultKey\);/);
  assert.match(source, /\{totalsAuthoritative && Object\.keys\(numericTotals\)\.length > 0 && \(/);
  assert.match(source, /\{totalsAuthoritative && total > 0 && groupRowsReady/);
});

test("same-query refresh and failure retain the last totals while server aggregates can publish early", () => {
  const loadStart = source.indexOf("const loadRecords = useCallback");
  const loadEnd = source.indexOf("// eslint-disable-next-line react-hooks/exhaustive-deps", loadStart);
  const load = source.slice(loadStart, loadEnd);
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  assert.doesNotMatch(load, /setTotalsResultKey\(null\)/);
  assert.match(load, /sameAggregateTopology[\s\S]*?setNumericTotals\(res\.numericTotals \?\? \{\}\)/);
  assert.match(load, /sameAggregateTopology[\s\S]*?setGroups\(res\.groups \?\? null\)/);
});

test("a records-query failure stays retryable instead of becoming a pending total forever", () => {
  assert.match(source, /const \[recordsLoadError, setRecordsLoadError\] = useState<string \| null>\(null\);/);
  assert.match(source, /setRecordsLoadError\(errorMessage\);/);
  assert.match(source, /data-testid="records-load-error"/);
  assert.match(source, /onClick=\{\(\) => setRefreshTick\(\(tick\) => tick \+ 1\)\}/);
  assert.match(source, /\{recordsLoadError \? \(\s*t\("records\.loadError"/);
});

test("same-row refresh publishes records and derived values atomically after projections", () => {
  assert.match(source, /const deferPublication =[\s\S]*?pendingRecordsPublicationRef\.current = \{[\s\S]*?setPendingRecordsPublicationId\(requestId\);[\s\S]*?return true;/);
  assert.match(
    source,
    /const projectionBundleReady =[\s\S]*?useEffect\(\(\) => \{[\s\S]*?pendingRecordsPublicationRef\.current[\s\S]*?setRecords\(response\.data\);[\s\S]*?setPageFormulaValues\(response\.pageFormulaValues/,
  );
  assert.match(source, /pageRelatedLoadingKey === expectedPageRelatedHydrationKey/);
  assert.match(source, /entityRelatedLoadingKey === expectedEntityRelatedHydrationKey/);
});

test("open relation pickers survive a projection refresh but cannot write until ready", () => {
  assert.match(source, /if \(\(entityRelationsPending \|\| entityRelationsUnavailable\) && !relationIsEditingThis\)/);
  assert.match(source, /relAssignable \|\| keepRelationPickerMounted[\s\S]*?disabled=\{!relAssignable\}/);
  assert.match(source, /if \(\(pageRelationsPending \|\| pageRelationsUnavailable\) && !isEditingThis\)/);
});

test("scope changes clear inline editor and conflict state without affecting background refresh", () => {
  assert.match(source, /setEditingCell\(null\);[\s\S]*?activeCellDirtyRef\.current = false;[\s\S]*?setConflictCell\(null\);/);
  assert.match(source, /const recordsRenderKeyRef = useRef<string \| null>\(null\);/);
});