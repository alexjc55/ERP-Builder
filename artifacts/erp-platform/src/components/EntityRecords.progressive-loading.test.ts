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

test("manual projection reservation reads the current tick without a duplicate records request", () => {
  assert.match(
    source,
    /const manualProjectionRefreshTickRef = useRef\(manualProjectionRefreshTick\);\s*manualProjectionRefreshTickRef\.current = manualProjectionRefreshTick;/,
  );
  assert.match(
    source,
    /const manualTickForFetch = manualProjectionRefreshTickRef\.current \+ \(manual \? 1 : 0\);\s*if \(manual\) manualProjectionReservationRef\.current = manualTickForFetch;\s*const generationForFetch = `\$\{requestId\}:\$\{manualTickForFetch\}`;/,
  );
  assert.match(source, /const projectionGeneration = `\$\{recordsProjectionGeneration\}:\$\{projectionManualTick\}`;/);
  assert.match(source, /const applied = await loadRecords\(true\);[\s\S]*?setManualProjectionRefreshTick/);
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

test("a records-query failure stays retryable instead of becoming a pending total forever", () => {
  assert.match(source, /const \[recordsLoadError, setRecordsLoadError\] = useState<string \| null>\(null\);/);
  assert.match(source, /setRecordsLoadError\(errorMessage\);/);
  assert.match(source, /data-testid="records-load-error"/);
  assert.match(source, /onClick=\{\(\) => setRefreshTick\(\(tick\) => tick \+ 1\)\}/);
  assert.match(source, /\{recordsLoadError \? \(\s*t\("records\.loadError"/);
});