---
quick: 260628-mvt
title: Graphify cleanup — delete 36 verified-dead files + method-level dead code + deposit-threshold doc alignment
branch: fix/remove-dead-sendotpmessage
requirements: [CLEANUP-DEADCODE-01]
completed: 2026-06-28
commits:
  - bb72cf2b  # Task 1: remove 36 + 4 cascaded dead files
  - 185a7bf1  # Task 2: drop dead service methods + events command-center loader
  - f4c4487f  # Task 3: ratify deposit threshold at 10+
  - 1020af2f  # Deviation fix: drop obsolete console-guard test case
pipeline:
  lint: pass
  tsc: pass
  build: pass
  test: "462 files / 2990 tests pass"
---

# Quick 260628-mvt: Graphify Cleanup Summary

Mechanically applied the graphify-driven cleanup spec: deleted 40 verified-dead files (36 from the confirmed list + 4 cascaded command-center orphans), removed 3 method-level dead-code items with their tests, and aligned the large-group deposit-threshold docs to 10+. Full lint/tsc/build/test pipeline is green.

## Task 1 — Deleted files (40 total)

All 36 paths in `graphify-out/sweep/confirmed_dead.txt` were removed via `git rm`. The events command-center cascade was then computed (bounded to `src/components/events/command-center/`): the 4 remaining siblings (ControlBar.tsx, EventCalendarView.tsx, EventExportPanel.tsx, TaskSidebar.tsx) were each confirmed to have zero importers outside the dir and no live consumers, so all 4 were deleted. The command-center directory is now empty.

**36 confirmed-dead:** EventCalendarView (events/_components), dishDevelopmentExport, UtmDropdown, OnboardingClient, PortalClient, diagnose-webhook-issues, oj-projects/system, webhooks (action), auth login page-client, LineChart, CommandCenterShell, EventCard, KPIHeader, DailyCashupForm, InsightsYearFilter, CateringPackageCard, CateringPackageDeleteButton, EmployeeRejectedShiftsTab, EventImageUpload, EventTemplateManager, shared/Pagination, use-debounce, use-swipe, usePagination, useShortLinkClickToasts, api/error-codes, bug-reporter/{console-logger,network-logger,screenshot-capture}, cache, event-seo/index, init, invoice-template, job-processor, quote-template, lib/supabase.

**4 cascaded command-center orphans:** ControlBar.tsx, EventCalendarView.tsx, EventExportPanel.tsx, TaskSidebar.tsx.

Verification: all 36 paths gone; `npx tsc --noEmit` clean. Commit `bb72cf2b`.

## Task 2 — Method-level dead code removed

- `src/services/customers.ts` — removed `toggleSmsOptIn` and `toggleWhatsAppOptIn` static methods (zero production callers; live toggles route through ConsentService). `createAdminClient` import still used elsewhere.
- `src/services/invoices.ts` — removed `persistOverdueInvoices` static method (zero callers). The two explanatory comments at ~lines 305/377 that mention the method by name were left intact, as specified. `createAdminClient`/`getTodayIsoDate` imports still used.
- `src/app/(authenticated)/events/get-events-command-center.ts` — removed only the `getEventsCommandCenterData` function. Kept the exported types. **Correction vs plan:** `schedule-calendar/adapters.ts` imports THREE types from this file (`EventOverview`, `PrivateBookingCalendarOverview`, `CalendarNoteCalendarOverview`), not just the two named in the plan — all exported types were preserved. File slimmed to type definitions plus the two type-only imports they require (`ChecklistTodoItem`/`EventChecklistItem`, `BookingStatus`); the loader-only imports and helper row types were dropped.
- `tests/services/mutation-race-guards.test.ts` — removed the 3 `toggleSmsOptIn` `it()` cases (no `toggleWhatsAppOptIn` cases existed). File: 519 → 357 lines; remaining 10 tests pass.

Verification: no dead refs remain; tsc clean; mutation-race-guards.test.ts green. Commit `185a7bf1`.

## Task 3 — Deposit-threshold doc alignment to 10+

- `CLAUDE.md` — domain rule "groups of 7 or more" → "groups of 10 or more".
- `tasks/handoff-prompt.md` — "groups of 7+" → "groups of 10+" (file was untracked; now committed).
- `docs/audits/2026-06-10-application-review.md` — appended to finding F1: "Resolved 2026-06-28: ruled 10+ (live code is authoritative); CLAUDE.md updated to match." Original finding text preserved. No historical QA packs or old plans/specs touched.

Verification: all three targets updated; no `groups of 7 or more` wording remains in CLAUDE.md. Commit `f4c4487f`.

## Deviations from Plan

**1. [Rule 3 - Blocking] Removed obsolete console-guard test case for a deleted file**
- **Found during:** Hard-backstop `npm test`.
- **Issue:** `tests/actions/diagnosticActionsConsoleGuards.test.ts` read `src/app/actions/diagnose-webhook-issues.ts` (deleted in Task 1, commit bb72cf2b) via `fs.readFileSync`, causing an ENOENT failure. This was a direct consequence of a verified-dead deletion.
- **Fix:** Removed only the obsolete `diagnose-webhook-issues` guard `it()` case; kept the `diagnose-messages.ts` case (file still live).
- **Files modified:** tests/actions/diagnosticActionsConsoleGuards.test.ts
- **Commit:** 1020af2f

**2. [Spec correction, no behavior change] Preserved all four exported types in get-events-command-center.ts**
- The plan named only `EventOverview`/`EventsOverviewResult` as types to keep. adapters.ts actually consumes three of the file's exported types. All exported types were preserved; nothing broke.

No files were reverted — every deletion/edit held under the full pipeline.

## Final Pipeline Status (hard backstop)

| Check | Result |
|-------|--------|
| `npm run lint` | PASS (0 warnings) |
| `npx tsc --noEmit` | PASS (clean) |
| `npm run build` | PASS |
| `npm test` | PASS (462 files / 2990 tests) |

## Self-Check: PASSED

- 40 staged deletions confirmed in commit bb72cf2b; all 36 confirmed_dead.txt paths verified gone.
- Dead refs (toggleSmsOptIn, toggleWhatsAppOptIn, persistOverdueInvoices, getEventsCommandCenterData) verified absent.
- `src/components/schedule-calendar/adapters.ts` still compiles (tsc clean) — EventOverview consumer intact.
- All 4 commits exist on branch fix/remove-dead-sendotpmessage.
