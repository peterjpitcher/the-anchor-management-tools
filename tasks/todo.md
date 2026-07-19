# Checklists: staff screen adjustments (2026-07-19)

Branch: feat/checklists. Working tree has unrelated parallel-session changes
(ProjectsOverview.tsx, tasks/lessons.md, recruitment specs): do not touch, stage explicit files only.

## Adjustments requested
- [x] 1. Hide done tasks by default; toggle in the sticky "Completing as" bar to show them
- [x] 2. Staff screen shows only tasks whose window has started (`window_start <= now`); manage view unchanged.
      Temperature readings are already anchor=open in prod data, so they all appear at open.
- [x] 3. Late thresholds: migration `default_grace_minutes` 30 to 60 (1h from open before late).
      `close_lead_minutes` already 60, so closing checks appear 1h before close once the filter exists.
- [x] 4. Back button on /checklists to /table-bookings/foh (the FOH screen that links here)

## Files
- src/app/actions/checklists.ts: `getTodayChecklist(date?, opts?: { dueOnly })`
- src/app/(authenticated)/checklists/page.tsx: dueOnly + back button
- src/app/(authenticated)/checklists/[date]/page.tsx: dueOnly
- src/app/(authenticated)/checklists/_components/ChecklistScreen.tsx: show-done toggle, empty states
- supabase/migrations/20260731000500_checklist_grace_60.sql: NEW (draft only, apply needs approval)

## Verify
- [x] lint (changed files, --max-warnings=0): clean
- [x] typecheck (`tsc --noEmit`): exit 0
- [x] tests: 3811 pass (551 files), no regressions
- [x] build: exit 0 on Node 20 with NODE_OPTIONS=--max-old-space-size=8192
      (default heap OOMs on this machine, pre-existing, not caused by this change)
- [x] Commit (checklist files only)

## Review
- Done tasks now hidden by default; "Show done (N)" toggle + "N of M done" count sit under the
  identity row in the sticky bar. All-done state shows a success alert.
- `getTodayChecklist` gained `opts.dueOnly` (filters `window_start <= now`). Staff pages pass it;
  /checklists/manage/today does not, so managers still see the whole day.
- Migration 20260731000500 DRAFTED, NOT applied to prod (needs explicit approval).
  sha256 c13fb55bb04f3af759d5266596e3b266116db315c62df3ebdc992abd440cff2d.
  Rollback: SET DEFAULT 30 + UPDATE row back to 30. After apply, pending instances pick up the new
  grace at the next reconcile run or via 'Regenerate today'.
- Back button links to /table-bookings/foh (works in FOH chromeless mode, no sidebar needed).
