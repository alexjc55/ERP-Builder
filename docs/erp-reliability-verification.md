# ERP reliability verification

## Consolidated scope

The ten source items are implemented together. They should be archived as
transferred, not counted as ten independently completed executions. This session
cannot archive accepted source tasks; their pending queue entries remain an
administrative action for the project owner.

| Source | Implementation and evidence |
| --- | --- |
| 113 | Transitive validation lock ownership analysis across package and wrapper delegation; positive/negative fixtures. |
| 125 | Bounded static traversal of local imports and authentic DB arguments through helper calls; mock/read-only distinctions and cycle guards. |
| 126 | Symbol-aware SQL constants, aliases and query-config resolution; unknown/mutable SQL fails closed. |
| 120 | Active collaboration tooltip portal, viewport clamping, keyboard/aria and stable editor slot. Three production mock-browser tests jointly cover this and formula metadata. |
| 136 | Authorized direct-lookup group presentation waits for metadata; error/retry and scope replacement withhold raw user IDs; numeric formulas remain numeric. |
| 122 | Ten mock-browser metadata cases verify every row and preservation of unsaved editor DOM, draft, focus and selection. |
| 123 | Four Chromium trusted-touch cases cover select/percent lists in LTR/RTL, swiping, selection, clearing, cancellation, edges and versioned writes. |
| 124 | Five opt-in production editor profiles use the unchanged 250 ms browser pointer-to-paint budget. Status uses the non-modal list picker; relation candidates survive same-scope background hydration. |
| 141 | Real two-session test forwards manual POST archive once, drops its successful response, reconnects SSE and verifies authoritative absence/counts, unchanged version/history and no reload. |
| 142 | Real two-session test revokes access with the original SSE still open; no further unauthorized presence/mutation frames, client clears state and stops heartbeats, unaffected participant continues. |

## Completed checks

- Static scanner regression suite: **124 passed**; repository inventory gate
  passes with **19 registered DB tests**. No source modules or SQL executed.
- Focused SSE/client transport suite: **10 passed**.
- Focused table/presentation unit suite after final product fixes: **15 passed**.
- API and frontend direct TypeScript checks passed.
- Guarded real Kanban suite: **2 passed**, approximately 1.2 minutes. Shared
  validation lock and an independently obtained development database fingerprint
  were required. Both scenarios verified removal of their entity/page/users/roles,
  records, automations/runs, audit/events/login history and restored the baseline
  database fingerprint.
- Standalone tooltip/formula mock-browser suite: **3 passed** on a fresh
  production build.
- Final combined production browser run after the picker fixes: **27 passed**,
  **5 opt-in profiles skipped** (those profiles passed separately), 3.9 minutes.
- Final editor profiles: **5 passed**. The four added first/reopen browser
  measurements were status **79.1/115.4 ms**, percent **151.2/102.3 ms**,
  user **78.4/79.2 ms**, relation **47.5/53.6 ms**. Automation wall time is
  reported separately and is not substituted for browser input latency.

## Failures found and resolved

- Completion review found named `FunctionDeclaration` transaction callbacks lost
  DB provenance after symbol resolution. Restored transaction-parameter tracking
  and added local/imported/aliased mutating and read-only regressions.
- The registered Kanban validation now supplies the independently verified
  development fingerprint with process-local development labels. A changed
  entity inventory will deliberately fail until independently verified again;
  the command never calculates its own approving fingerprint.

- Status initially measured 295.7/494.1 ms and relation reopening 273.9 ms.
  Fixed the measured modal-picker cost and the relation picker remount rather
  than increasing the budget.
- Mock fixtures needed explicit dashboard endpoints and correct percent/empty
  write representations. Unexpected API requests remain failures.
- Manual archive test originally assumed a mirror pageId on a bound-entity
  request. Corrected that assertion and strengthened asynchronous route failure
  handling and fixture cleanup before pool shutdown. The failed run's exact
  fixture was removed under the shared lock; the independent baseline was restored.
- An inherited production environment label blocked the first real test before
  writes. Process-local development labels were used only after independent
  development database identity verification; no production operations occurred.

## Limitations

- WebKit/Safari touch behavior was not verified; Chromium uses trusted CDP touch,
  not mouse events described as touch.
- Five broader pre-existing source-text assertion failures were reproduced against
  the unchanged baseline by the table worker. They concern archived/bulk status,
  group-loading, stale page values and bootstrap source patterns; these are not
  reported as passing.
- Preview screenshots show the unauthenticated login screen. Signed-in behavior
  is verified by the mock-browser and isolated real-session tests, not by that
  screenshot.
- Static scanning is bounded analysis, not a sandbox for arbitrary JavaScript,
  shell or SQL. See `db-test-wiring-scanner.md`.

See `inline-editor-performance.md` for the final full-browser run and profile
commands, separate wall-clock figures, baseline and reproduction details.