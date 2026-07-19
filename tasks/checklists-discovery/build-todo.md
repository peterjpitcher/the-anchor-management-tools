# Checklists build tracker (Phases 2 to 4)

Branch `feat/checklists`. Phase 1 done (foundation, dark). Building 2 to 4 to the iPad-UAT
boundary. Spec: [spec.md](spec.md) v4. Commit continuously; gate (lint/tsc/test/build)
between phases.

## Phase 2, capture

- [ ] `resolveTradingWindow(date)` async wrapper (reads business_hours + special_hours), on trading-window.ts
- [ ] `settings.ts` reader (flags, grace, lead, thresholds)
- [ ] rota reader: shifts for a business date (published snapshot, 3-predicate filter) + closer/coverage wiring
- [ ] `computeDesiredInstances(...)` pure + tests (expand templates for a date to instance rows)
- [ ] generation job handler (run row, reconcile, expectations, mismatch, outbox on unresolved)
- [ ] sweep job handler (per-instance grace_until, lock resolved)
- [ ] outbox processor job handler (retries, backoff, sendEmail, terminal alert)
- [ ] register 3 job types (union + SUPPORTED_JOB_TYPES + executeJob switch)
- [ ] cron route /api/cron/checklists-generate + vercel.json entry
- [ ] server actions: getTodayChecklist, completeInstance (guarded UPDATE), undoInstance, attribution candidates
- [ ] /checklists section layout + today page + [date] page + client components (sticky identity, value input, notes, breach banner, unavailable state)
- [ ] FOH button in FohHeader
- [ ] FOH_MODULES widen + AuthenticatedLayout both gates + api-auth regression test + flip user-mode test
- [ ] migration: foh_staff checklists:view grant
- [ ] seed migration: bar checklist per decision 27, templates INACTIVE
- [ ] gate green + commit

## Phase 3, oversight

- [ ] /checklists/manage section (Setup, Today, Insights, Spot checks, Problems)
- [ ] Setup CRUD server actions + UI (activation validation)
- [ ] Insights aggregation actions (paginated reads, metric dictionary) + super_admin gate
- [ ] Problems view
- [ ] spot-check draw RPC (advisory lock + weighted sample) + record action + employee audit write
- [ ] audit-trail .limit(50) fix + filter
- [ ] weekly summary cron + outbox row + template
- [ ] mismatch detection wired into generation (already in P2 job) + Problems surfacing
- [ ] nav item in NAV_GROUPS
- [ ] gate green + commit

## Phase 4, polish

- [ ] mid-shift modal (prompts_enabled, sessionStorage dismissal, idle guard)
- [ ] todos mini-spec + CRUD + UI
- [ ] seasonal boundary prompt
- [ ] retention purge job (24 months)
- [ ] gate green + commit

## Owner gates (cannot be done autonomously)
- iPad UAT sign-off (Phase 2)
- Apply migrations to prod + flip module_enabled/generation_enabled/emails_enabled
- Merge feat/checklists
