# Checklists, implementation plan

Date: 2026-07-17. Spec: [spec.md](spec.md) v4, all decisions settled (1-27), seed table
resolved. This is the build order. One phase per branch, verification pipeline (lint,
typecheck, test, build, `db push --dry-run`) before every merge.

## Phase 1, foundation (ships dark, no UI)

- [ ] `src/lib/foh/__tests__/user-mode.test.ts`: pin current `isFohOnlyUser` behaviour
      BEFORE anything else touches it
- [ ] Migration: 10 tables per spec §3 (checklists, task_templates, task_instances,
      spot_checks, todos, email_outbox, settings singleton, hours_mismatches,
      spot_check_expectations, generation_runs), all §3.12 CHECK constraints, indexes,
      RLS enabled with NO policies (deny-all, service-role only), `ON DELETE RESTRICT`
      on employee FKs
- [ ] Migration: RBAC seeding, `checklists` module, `view` + `manage`, granted to staff /
      manager / super_admin, deliberately NOT foh_staff (defensive `DO $$` pattern per
      `20260703090000_feedback_rbac_permissions.sql`)
- [ ] Migration: settings row (id=1) with ALL FLAGS FALSE
- [ ] `src/types/rbac.ts`: add `checklists` to the ModuleName union
- [ ] `src/lib/checklists/trading-window.ts` + tests (§5.1 truth table, never fabricates)
- [ ] `src/lib/checklists/window.ts` + tests (§5.3 instants, cross-midnight, DST, past-06:00 invalid)
- [ ] `src/lib/checklists/cadence.ts` + tests (calendar anchors incl. 31st clamp + 29 Feb,
      seasons wrap, every-N slots, floating next_due with the §4 example table verbatim)
- [ ] `src/lib/checklists/accountability.ts` + tests (closer ordering, coverage, all §13
      prod-trap fixtures)
- [ ] `src/lib/checklists/scoring.ts` + tests (timeliness 10/5, suppression floor 30)
- [ ] `src/lib/checklists/mismatch.ts` + tests (Sunday cleaning shift must not fire)
- [ ] `src/lib/checklists/spot-draw.ts` + tests (weighted, seeded RNG, sticky, top-up)
- [ ] Full pipeline green, merge, verify deploy, confirm nothing user-visible changed

## Phase 2, capture

- [ ] Job types `checklist_generate_day`, `checklist_sweep`,
      `checklist_email_outbox_process` registered in ALL THREE places
      (`unified-job-queue.ts` union :26-41, SUPPORTED_JOB_TYPES :43-59, executeJob :985)
- [ ] Generation job (§5.4: run row, transaction, reconcile, mismatch, expectations)
- [ ] Sweep job (§5.6: per-instance grace_until, locks resolved rows)
- [ ] Outbox processor (retries, backoff, terminal alert to Peter)
- [ ] Cron `/api/cron/checklists-generate` (`0 4 * * *`, authorizeCronRequest, London gate)
- [ ] Tick RPC (conditional update, breach outbox row in-transaction)
- [ ] `/checklists` open/close screen (cashing-up layout pattern): sticky "Completing as",
      picker (clocked-in via getOpenSessions + rostered + search), values with typo guard,
      notes, undo (15 min), unavailable/closed banners, degraded-network states
- [ ] FOH button in FohHeader action row (raw-button style), gated on module_enabled
- [ ] `FOH_MODULES` change in user-mode.ts + BOTH AuthenticatedLayout gates (:92-100 AND
      :130) + regression test that BOH API still 403s
- [ ] Seed migration: bar checklist per decision 27 values, templates INACTIVE, reworded
      item 16, typos fixed, Freshen omitted, pool table split in two
- [ ] Same deploy: checklists:view grant to foh_staff + FOH_MODULES change together
- [ ] iPad UAT (§13 checklist incl. 90-second timing) BEFORE flags on
- [ ] Enable module_enabled + generation_enabled on a quiet day; hand-check the first run

## Phase 3, oversight

- [ ] `/checklists/manage`: Setup CRUD + activation validation, Today (runs, outstanding,
      regenerate, flags), Insights (super_admin, paginated aggregates, metric dictionary),
      Spot checks (draw RPC + recording + employee audit write), Problems (super_admin)
- [ ] EmployeeAuditTrail: raise the 50-row cap + filter
- [ ] Weekly summary cron (`0 * * * 1`, London-09:00 gate, outbox key weekly_summary:<iso-week>)
- [ ] Nav item in NAV_GROUPS group 3

## Phase 4, polish

- [ ] Mid-shift modal behind prompts_enabled (§9.2 prompt contract)
- [ ] Todos (one-page mini-spec first)
- [ ] Season-boundary prompt to Billy
- [ ] Retention purge job (24 months, decision 27), due before mid-2028

## Review section (filled as phases complete)

### Phase 1, foundation, built 2026-07-18 (branch feat/checklists)

Delivered dark: no UI, no cron, no jobs, all `checklist_settings` flags default false.

- **Migration** `supabase/migrations/20260731000000_checklists_foundation.sql`: 10 tables,
  the section 3.12 CHECK constraints, deny-all service-role-only RLS on all 10 tables, the
  `checklists` RBAC module seeded to super_admin/manager (view+manage) and staff (view).
  foh_staff deliberately not granted (Phase 2). Dry-run recognised it as the single pending
  migration; NOT pushed to prod (that is a Phase 2/go-live step).
- **RBAC** `src/types/rbac.ts`: `checklists` added to the ModuleName union.
- **Engine** `src/lib/checklists/` (pure, fully unit-tested, 50 tests):
  `types.ts`, `trading-window.ts` (5.1 truth table), `window.ts` (cross-midnight instants),
  `cadence.ts` (anchors, seasons, every-N, floating), `accountability.ts` (closer/coverage),
  `scoring.ts` (timeliness), `mismatch.ts` (section 8), `spot-draw.ts` (weighted, seedable).
  Built by seven parallel TDD agents, each owning two disjoint files.
- **Characterization test** `src/lib/foh/__tests__/user-mode.test.ts`: pins `isFohOnlyUser`
  before Phase 2 widens it.

**Verification gate: all green.** lint 0 warnings, `tsc --noEmit` clean, full suite
3798 tests pass, cold `npm run build` succeeds (the first build failed on a stale `.next`
`/_document` cache artifact, cleared per the cold-build lesson), migration dry-run clean.
Adversarial review of the migration + engine run separately.

**Deviations from the plan:** none material. `mismatch.ts` did not need to import `types.ts`
(self-contained). Tasks committed per-task with explicit-path staging (this repo has a
parallel-session git hazard; a concurrent edit to an unrelated oj-projects component was
left untouched and never staged).

### Phase 2 onward: needs the owner

Phase 2 changes the live FOH iPad (`FOH_MODULES` widening + the foh_staff grant) and the
spec requires an **iPad UAT sign-off** and the owner enabling the kill-switch flags on a
quiet day. Those are owner gates, not autonomous steps.
