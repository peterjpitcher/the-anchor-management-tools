---
phase: quick-260628-mvt
plan: 01
type: execute
wave: 1
depends_on: []
branch: fix/remove-dead-sendotpmessage
files_modified:
  # Task 1 — 36 confirmed-dead deletes (+ cascaded command-center orphans)
  - src/app/(authenticated)/events/_components/EventCalendarView.tsx
  - src/app/(authenticated)/menu-management/_lib/dishDevelopmentExport.ts
  - src/app/(authenticated)/short-links/_components/UtmDropdown.tsx
  - src/app/(employee-onboarding)/onboarding/[token]/OnboardingClient.tsx
  - src/app/(staff-portal)/portal/_components/PortalClient.tsx
  - src/app/actions/diagnose-webhook-issues.ts
  - src/app/actions/oj-projects/system.ts
  - src/app/actions/webhooks.ts
  - src/app/auth/login/page-client.tsx
  - src/components/charts/LineChart.tsx
  - src/components/events/command-center/CommandCenterShell.tsx
  - src/components/events/command-center/EventCard.tsx
  - src/components/events/command-center/KPIHeader.tsx
  - src/components/features/cashing-up/DailyCashupForm.tsx
  - src/components/features/cashing-up/InsightsYearFilter.tsx
  - src/components/features/catering/CateringPackageCard.tsx
  - src/components/features/catering/CateringPackageDeleteButton.tsx
  - src/components/features/employees/EmployeeRejectedShiftsTab.tsx
  - src/components/features/events/EventImageUpload.tsx
  - src/components/features/events/EventTemplateManager.tsx
  - src/components/features/shared/Pagination.tsx
  - src/hooks/use-debounce.ts
  - src/hooks/use-swipe.ts
  - src/hooks/usePagination.ts
  - src/hooks/useShortLinkClickToasts.ts
  - src/lib/api/error-codes.ts
  - src/lib/bug-reporter/console-logger.ts
  - src/lib/bug-reporter/network-logger.ts
  - src/lib/bug-reporter/screenshot-capture.ts
  - src/lib/cache.ts
  - src/lib/event-seo/index.ts
  - src/lib/init.ts
  - src/lib/invoice-template.ts
  - src/lib/job-processor.ts
  - src/lib/quote-template.ts
  - src/lib/supabase.ts
  # Task 2 — method-level dead code
  - src/services/customers.ts
  - src/services/invoices.ts
  - src/app/(authenticated)/events/get-events-command-center.ts
  - tests/services/mutation-race-guards.test.ts
  # Task 3 — doc alignment
  - CLAUDE.md
  - tasks/handoff-prompt.md
  - docs/audits/2026-06-10-application-review.md
autonomous: true
requirements: [CLEANUP-DEADCODE-01]

must_haves:
  truths:
    - "All 36 confirmed-dead files are removed from the repo"
    - "No remaining file under src/components/events/command-center/ is orphaned (imported by nothing)"
    - "CustomerService no longer exposes toggleSmsOptIn or toggleWhatsAppOptIn"
    - "InvoiceService no longer exposes persistOverdueInvoices"
    - "getEventsCommandCenterData function is gone but EventOverview/EventsOverviewResult types remain importable by adapters.ts"
    - "CLAUDE.md, tasks/handoff-prompt.md, and audit F1 state the deposit threshold as 10+"
    - "Full pipeline (lint, tsc, build, test) passes"
  artifacts:
    - path: src/components/schedule-calendar/adapters.ts
      provides: "Live consumer of EventOverview type — must still compile after Task 2"
      contains: "EventOverview"
  key_links:
    - from: src/components/schedule-calendar/adapters.ts
      to: src/app/(authenticated)/events/get-events-command-center.ts
      via: "type import of EventOverview / EventsOverviewResult"
      pattern: "get-events-command-center"
---

<objective>
Execute the graphify-driven cleanup spec: delete 36 graph-verified dead files (plus any command-center siblings that become orphaned), remove 3 method-level dead-code items, and align the large-group deposit-threshold docs to 10+.

Purpose: Remove confirmed-dead code that inflates the codebase and misleads future work, and ratify the deposit threshold at 10+ (live code is authoritative per the 2026-06-28 user ruling).
Output: 3 atomic commits on branch fix/remove-dead-sendotpmessage; a green lint/tsc/build/test pipeline.
</objective>

<execution_context>
This is a mechanical apply of an already-verified spec. The scope is fixed — do NOT expand, re-investigate, or second-guess the file list. The only judgement call is the bounded command-center cascade in Task 1, gated strictly by grep + tsc.

The hard backstop after ALL tasks: `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test` — all must pass. If any single change breaks the pipeline, revert ONLY that change and report it.

Branch is fixed: fix/remove-dead-sendotpmessage (already checked out). All 3 commits stay on it.
</execution_context>

<context>
@graphify-out/sweep/DELIVERY_SPEC.md
@graphify-out/sweep/confirmed_dead.txt

<verified_facts>
- Current branch is already fix/remove-dead-sendotpmessage.
- src/components/events/command-center/ contains 7 files. 3 are in confirmed_dead.txt (CommandCenterShell.tsx, EventCard.tsx, KPIHeader.tsx). The remaining 4 are cascade candidates: ControlBar.tsx, EventCalendarView.tsx, EventExportPanel.tsx, TaskSidebar.tsx.
- src/services/customers.ts: toggleSmsOptIn at line ~510, toggleWhatsAppOptIn at line ~578 (static methods).
- tests/services/mutation-race-guards.test.ts references toggleSmsOptIn (and toggleWhatsAppOptIn) — remove those test cases.
- src/services/invoices.ts: persistOverdueInvoices static method at line ~250. Note: lines ~305/~377 contain COMMENTS that merely mention the old method by name — leave those comments alone (they document why the write was removed).
- src/app/(authenticated)/events/get-events-command-center.ts: getEventsCommandCenterData function at line ~97. The file ALSO exports EventOverview and EventsOverviewResult types, which are imported (alive) by src/components/schedule-calendar/adapters.ts (lines 4 + 7). KEEP those types.
</verified_facts>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Delete 36 confirmed-dead files + cascaded command-center orphans</name>
  <files>All 36 paths in graphify-out/sweep/confirmed_dead.txt, plus any now-orphaned files under src/components/events/command-center/ (cascade candidates: ControlBar.tsx, EventCalendarView.tsx, EventExportPanel.tsx, TaskSidebar.tsx)</files>
  <action>
1. Delete every one of the 36 paths in graphify-out/sweep/confirmed_dead.txt using `git rm` (run from repo root). These are verified zero-importer, non-convention, non-live files. Quote paths containing parentheses/brackets.
2. Recompute the command-center cascade — bounded strictly to src/components/events/command-center/:
   For each remaining file in that dir (ControlBar.tsx, EventCalendarView.tsx, EventExportPanel.tsx, TaskSidebar.tsx), grep the whole repo for importers of that file's path/basename. If a file is imported by NOTHING that survives (and `npx tsc --noEmit` stays clean after removing it), `git rm` it too.
   - Do this iteratively: deleting one orphan may orphan another sibling. Repeat until no command-center file is unreferenced.
   - Do NOT delete any file outside src/components/events/command-center/ on this cascade.
   - Stop the moment the build is clean and no command-center file is orphaned. If a command-center file IS still referenced by a live file, KEEP it.
3. Record the exact final list of deleted files (the 36 + any cascaded ones) for the report.
Commit on the current branch: `chore(quick-260628-mvt): remove 36 graph-verified dead files (+ cascaded command-center orphans)`
  </action>
  <verify>
    <automated>cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && bash -c 'rc=0; while IFS= read -r f; do [ -z "$f" ] && continue; if [ -e "$f" ]; then echo "STILL EXISTS: $f"; rc=1; fi; done < graphify-out/sweep/confirmed_dead.txt; npx tsc --noEmit && echo "TSC_CLEAN" || rc=1; exit $rc'</automated>
  </verify>
  <done>All 36 listed files are gone; no command-center file remains orphaned; `npx tsc --noEmit` is clean; deletions committed.</done>
</task>

<task type="auto">
  <name>Task 2: Remove 3 method-level dead-code items + their tests</name>
  <files>src/services/customers.ts, src/services/invoices.ts, src/app/(authenticated)/events/get-events-command-center.ts, tests/services/mutation-race-guards.test.ts</files>
  <action>
1. src/services/customers.ts — remove the entire `toggleSmsOptIn` static method (~line 510) and the entire `toggleWhatsAppOptIn` static method (~line 578). Do NOT touch any other CustomerService method.
   - In tests/services/mutation-race-guards.test.ts, remove the `it(...)` test cases that reference toggleSmsOptIn / toggleWhatsAppOptIn (grep for both names; remove only those cases, leaving surrounding describe blocks and unrelated tests intact).
2. src/services/invoices.ts — remove the `persistOverdueInvoices` static method (~line 250) and any test that references it. IMPORTANT: leave the explanatory comments at ~lines 305/377 that merely mention the old method name — they document the removed write path and are not code.
3. src/app/(authenticated)/events/get-events-command-center.ts — remove ONLY the `getEventsCommandCenterData` function (~line 97). KEEP the exported types `EventOverview` and `EventsOverviewResult` — they are still imported by src/components/schedule-calendar/adapters.ts.
   - Cascade check: after Task 1's command-center deletions, grep for any remaining live importer of `get-events-command-center` (adapters.ts must still be one). If NO live file imports EventOverview/EventsOverviewResult any longer, `git rm` the whole file and fix any now-broken import in adapters.ts only if the import truly became dead — confirm with grep + tsc before deleting. Otherwise keep the file with just the types.
Commit on the current branch: `refactor(quick-260628-mvt): drop dead service methods + abandoned events command-center loader`
  </action>
  <verify>
    <automated>cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && bash -c 'rc=0; grep -rn "toggleSmsOptIn\|toggleWhatsAppOptIn" src/services/customers.ts tests/services/mutation-race-guards.test.ts && { echo "DEAD REFS REMAIN"; rc=1; }; grep -n "static async persistOverdueInvoices" src/services/invoices.ts && { echo "persistOverdueInvoices REMAINS"; rc=1; }; grep -n "function getEventsCommandCenterData" "src/app/(authenticated)/events/get-events-command-center.ts" 2>/dev/null && { echo "loader REMAINS"; rc=1; }; npx tsc --noEmit && echo "TSC_CLEAN" || rc=1; exit $rc'</automated>
  </verify>
  <done>toggleSmsOptIn/toggleWhatsAppOptIn, persistOverdueInvoices, and getEventsCommandCenterData are gone; their tests removed; EventOverview/EventsOverviewResult still resolve in adapters.ts; tsc clean; committed.</done>
</task>

<task type="auto">
  <name>Task 3: Align deposit-threshold docs to 10+</name>
  <files>CLAUDE.md, tasks/handoff-prompt.md, docs/audits/2026-06-10-application-review.md</files>
  <action>
Docs-only change (no code). The £10pp large-group deposit threshold is 10+ in live code; user ruled 2026-06-28 that 10+ is authoritative and the docs should be fixed.
1. CLAUDE.md — in the Domain Rules section, change "£10 deposit per person for groups of 7 or more" to "groups of 10 or more" (keep the rest of the line intact).
2. tasks/handoff-prompt.md — change "groups of 7+" in the deposit domain-rule line to "groups of 10+".
3. docs/audits/2026-06-10-application-review.md — locate finding item F1 and APPEND a resolution note (do not rewrite the original finding text): "Resolved 2026-06-28: ruled 10+ (live code is authoritative); CLAUDE.md updated to match."
Do NOT edit historical QA packs under tasks/codex-qa-review/ or old plans/specs under docs/ — those are point-in-time records.
Commit on the current branch: `docs(quick-260628-mvt): ratify large-group deposit threshold at 10+ (align CLAUDE.md + audit F1)`
  </action>
  <verify>
    <automated>cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && bash -c 'rc=0; grep -q "groups of 10 or more" CLAUDE.md || { echo "CLAUDE.md not updated"; rc=1; }; grep -q "groups of 10+" tasks/handoff-prompt.md || { echo "handoff not updated"; rc=1; }; grep -q "Resolved 2026-06-28" docs/audits/2026-06-10-application-review.md || { echo "audit F1 not updated"; rc=1; }; grep -q "groups of 7 or more" CLAUDE.md && { echo "old 7+ wording remains in CLAUDE.md"; rc=1; }; exit $rc'</automated>
  </verify>
  <done>CLAUDE.md and tasks/handoff-prompt.md say 10+; audit F1 has the resolution note appended; no 7+ deposit wording remains in those three files; committed.</done>
</task>

</tasks>

<verification>
Hard backstop — run after ALL three tasks/commits. Every check must pass:

```bash
npm run lint        # zero warnings
npx tsc --noEmit    # clean
npm run build       # succeeds
npm test            # all pass
```

If any check fails, identify the single offending change and revert ONLY that change (e.g. restore a wrongly-deleted file with `git checkout HEAD~N -- path`, or re-add a method), then re-run the full pipeline. Report any reverted item.
</verification>

<success_criteria>
- All 36 confirmed-dead files deleted; command-center cascade resolved (no orphan, nothing live broken).
- 3 dead method-level items removed with their tests; EventOverview/EventsOverviewResult preserved and still consumed by adapters.ts.
- Deposit-threshold docs aligned to 10+ in CLAUDE.md, tasks/handoff-prompt.md, and audit F1.
- 3 atomic commits on fix/remove-dead-sendotpmessage.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test` all pass.
</success_criteria>

<output>
After completion, create `.planning/quick/260628-mvt-graphify-cleanup-delete-36-verified-dead/260628-mvt-SUMMARY.md` reporting: exact list of deleted files (36 + cascaded), method/test edits made, doc changes, any reverts, and final pipeline status.
</output>
