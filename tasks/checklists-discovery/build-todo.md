# Checklists build tracker (Phases 2 to 4)

Branch `feat/checklists`. Phase 1 done (foundation, dark). Building 2 to 4 to the iPad-UAT
boundary. Spec: [spec.md](spec.md) v4. Commit continuously; gate (lint/tsc/test/build)
between phases.

## Phase 2, capture

- [x] `resolveTradingWindow(date)` async wrapper (reads business_hours + special_hours), on trading-window.ts
- [x] `settings.ts` reader (flags, grace, lead, thresholds)
- [x] rota reader: shifts for a business date (published snapshot, 3-predicate filter) + closer/coverage wiring
- [x] `computeDesiredInstances(...)` pure + tests (expand templates for a date to instance rows)
- [x] generation job handler (run row, reconcile, expectations, mismatch, outbox on unresolved)
- [x] sweep job handler (per-instance grace_until, lock resolved)
- [x] outbox processor job handler (retries, backoff, sendEmail, terminal alert)
- [x] register 3 job types (union + SUPPORTED_JOB_TYPES + executeJob switch)
- [x] cron route /api/cron/checklists-generate + vercel.json entry
- [x] server actions: getTodayChecklist, completeInstance (guarded UPDATE), undoInstance, attribution candidates
- [x] /checklists section layout + today page + [date] page + client components (sticky identity, value input, notes, breach banner, unavailable state)
- [x] FOH button in FohHeader
- [x] FOH_MODULES widen + AuthenticatedLayout both gates + api-auth regression test + flip user-mode test
- [x] migration: foh_staff checklists:view grant
- [x] seed migration: bar checklist per decision 27, templates INACTIVE
- [x] gate green + commit

## Phase 3, oversight

- [x] /checklists/manage section (Setup, Today, Insights, Spot checks, Problems)
- [x] Setup CRUD server actions + UI (activation validation)
- [x] Insights aggregation actions (paginated reads, metric dictionary) + super_admin gate
- [x] Problems view
- [x] spot-check draw RPC (advisory lock + weighted sample) + record action + employee audit write
- [x] audit-trail .limit(50) fix + filter
- [x] weekly summary cron + outbox row + template
- [x] mismatch detection wired into generation (already in P2 job) + Problems surfacing
- [x] nav item in NAV_GROUPS
- [x] gate green + commit

## Phase 4, polish

- [x] mid-shift modal (prompts_enabled, sessionStorage dismissal, idle guard)
- [x] todos mini-spec + CRUD + UI
- [x] seasonal boundary prompt
- [x] retention purge job (24 months)
- [x] gate green + commit

## STATUS: Phases 2-4 all built, gated green, committed on feat/checklists (dark).

## Owner gates (cannot be done autonomously)
- iPad UAT sign-off (Phase 2)
- Apply migrations to prod + flip module_enabled/generation_enabled/emails_enabled
- Merge feat/checklists
