# Disposition of the developer review (spec v3 → v4)

Date: 2026-07-17. Review: [spec-review-developer-report.md](spec-review-developer-report.md)
(47 confirmed findings, 5 optional improvements). Spec updated in place to **v4**:
[spec.md](spec.md).

Honest summary first: the review's verdict ("not ready") was correct for v3. Four findings
are genuine contradictions I wrote (F-02, F-07, F-09 vs §9.2, F-39), and three of its
sharpest technical claims were verified against the code before accepting (F-10, F-17,
F-30, all confirmed). v4 closes every P0. What remains open is a bounded list of seed
values only the owner can approve (spec §17).

## Legend

- **Fixed**: applied in v4, section given.
- **Light**: accepted in a proportionate form for a single-pub internal tool, section given.
- **Owner**: needs Peter's decision; queued in spec §17's seed table.
- **Adjusted**: accepted with a changed remedy, reason given.
- **Rejected**: not applied, reason given.

## P0 findings

| # | Disposition | Where / why |
|---|-------------|-------------|
| F-01 seed decisions unresolved | **Owner** | §17 now a blocking seed-decision table with proposed values. Phase 2 seed blocked on it. |
| F-02 floating vs sweep/lock contradiction | **Fixed** | §4 floating rewritten: `grace_until` spans the tolerance window; the sweep acts per instance on `grace_until`, not per business date. Worked date examples added. |
| F-03 floating formula incomplete | **Fixed** | §4: explicit formula, `first_due_on` column added (no `created_at` abuse), early/late/miss/never examples. |
| F-04 calendar anchors missing | **Fixed** | §3.2 `anchor_date` column; §4 rules for bi-weekly, monthly (clamp 29-31), quarterly, annual (29 Feb → 28 Feb). |
| F-05 cross-midnight windows | **Fixed** | §5.3: `closes <= opens` means next day; single window-expansion function returns zoned instants; `closes` past 06:00 is a config error; `opens = closes` invalid. |
| F-06 closer boundary semantics | **Fixed** | §6: close tasks use the business date's latest eligible shift (the full ordering), not instant coverage; non-close coverage is inclusive `[start, end]`; query range defined. |
| F-07 accountability contradiction | **Fixed** | §6: ONE rule. Every miss is attributed to the business date's closer (decision 8). The covering-shift person is stored as context only, never as blame. |
| F-08 sweep trigger undefined | **Fixed** | §5.2: the daily cron enqueues generation for today AND the sweep; §5.6: sweep acts on `grace_until < now`, idempotent, catch-up safe. |
| F-09 slot_due has no behaviour | **Fixed** | Removed entirely (with O-01). Three job types remain. The FOH minute tick + 60s poll already cover due-time UX. |
| F-10 queue unique is not durable idempotency | **Fixed** | Verified in code (15-min enqueue lock, pending/processing search only). §5: every handler is idempotent via DB constraints (instance unique key, outbox `idempotency_key` unique, run-row upsert, state-guarded sweep). |
| F-11 generation not atomic | **Fixed** | §3.11 `checklist_generation_runs` + §5.4: instances/expectations/mismatches commit under a run row; enqueues happen after commit; retry reconciles. Also gives provenance (O-05). |
| F-12 late-hours regen doesn't fix open/close slots | **Fixed** | §5.4: rerun reconciles by comparing desired rows to existing pending rows and updating timestamps in place; deletes out-of-window pending; never touches done rows. |
| F-13 state integrity not in DB | **Fixed** | §3.12: cross-field CHECK list (done requires completer+time, value tasks require value, missed forbids completion data, min<=max, positive intervals, valid MM-DD). Spot-check identity enforced server-side (cross-table). |
| F-14 hard delete vs immutable history | **Fixed** | §3.1/§9.4: `ON DELETE RESTRICT` once instances exist; deactivate/archive instead; a never-used template may be hard-deleted. |
| F-15 RLS unspecified | **Fixed** | §12: deny-all policies for anon+authenticated on all nine tables; service-role only; every read/write through server actions after permission checks; no client-side reads; no realtime on checklist tables (poll via server action). |
| F-16 email not durable | **Fixed** | §3.7 is now an outbox (status pending/held/sent/failed, source, idempotency key, attempts); breach row written in the same transaction as the tick; processed by the jobs queue with retries. |
| F-17 reporting truncation | **Fixed** | Verified (no pagination in the cited pattern; 1000-row default cap). §9.4: explicit `.range()` pagination loop with completeness assertion; ranges capped at 92 days. |
| F-18 score is not a completion score | **Fixed** | §7: renamed **Timeliness (completed ticks)**; §9.4 metric dictionary adds Venue completion rate (includes misses) and Missed-by-closer. Decision 24's formula unchanged. |
| F-19 mismatch table can't hold 3 kinds/day | **Fixed** | §3.9: `unique (business_date, kind)`; stores resolved instants. |
| F-39 rollback description wrong | **Fixed** | §14 rewritten as a per-phase deploy/rollback runbook; flags first, code second; jobs/grants/FOH revert together; iPad verify step. |

## P1 findings

| # | Disposition | Where / why |
|---|-------------|-------------|
| F-20 draw not atomic | **Fixed** | §11: draw runs in one transaction with `pg_advisory_xact_lock` per business date. |
| F-21 weighting/counters undefined | **Fixed** | §11: algorithm defined (weight 1/(1+checks in last 14 days), injectable RNG); `drawn`/`recorded` derived from spot-check rows, not maintained counters. |
| F-22 name visibility contradiction | **Fixed** | §9.3/§9.4: field-level rule. Picker shows active names (necessary); a transient "Done, Amanda" confirmation is allowed; history, scores and attribution live only in manage views. |
| F-23 skip/undo/correction journeys | **Fixed** | §5.8: full state-transition table. Staff undo own tick ≤15 min pre-lock; skip/NA is manage-only with reason; nothing changes after lock. |
| F-24 "manager override" undefined | **Fixed** | §5.8/§6: replaced by two defined actions, closer reassignment and pre-lock correction. The vague score override is deleted. |
| F-25 config validation | **Fixed** | §3.12 + §9.4: cross-field CHECKs, settings singleton (`id = 1`), Zod mirror in Setup, validation at activation not at generation. |
| F-26 snapshot incomplete | **Fixed** | §3.3: `is_spot_checkable` snapshotted. Checklist name stays a live join (renames are cosmetic, stated). Employee names are live identity, employees are never hard-deleted (F-47). |
| F-27 resolver truth table | **Fixed** | §5.1: full truth table for special-row present/absent, `is_closed` true/false/null, partial times. |
| F-28 prompt persistence | **Fixed** | §9.2: per-device sessionStorage, one modal groups all due tasks, dismissal consumes for that device, reappears next slot only. |
| F-29 90-second target vs picker | **Fixed** | §9.3: sticky "completing as" identity with per-task override (O-04). §14: timed on the real iPad in Phase 2 UAT before go-live. |
| F-30 weekly cron DST | **Fixed** | Verified precedent. §10: hourly Monday cron gated on London 09:00, outbox idempotency key `weekly_summary:<iso-week>`. |
| F-31 metrics undefined | **Fixed** | §9.4: metric dictionary (formulas, denominators, windows, suppression); §10: exact weekly email contents. Metrics computed over locked days only. |
| F-32 missing-generation UX | **Fixed** | §9.3: FOH shows "checklist unavailable, tell Peter" when no complete run exists; §9.4: run status + audited Regenerate. |
| F-33 monitoring | **Light** | §10/§9.4: generation failure and unresolvable hours already email Peter; the manage Today tab shows run status, old pending count and outbox backlog. No separate alerting stack for one pub. |
| F-34 audit coverage | **Fixed** | §5.8/§9.4: audit event list for template/checklist/settings changes, activation, regen, reassignment, corrections, flags. Uses existing `logAuditEvent`. |
| F-35 privacy governance | **Light** | §7: one recorded paragraph (purpose, viewers, no consequences, employees may ask Peter to see their records, weekly email carries no individual scores). A formal governance pack is disproportionate; decision 4 already records the owner's choice. |
| F-36 accessibility | **Light** | §9: acceptance list (44px targets, visible focus, labels, colour never sole indicator, modal focus trap/Escape already via Headless UI, VoiceOver pass on the iPad in UAT). Full WCAG programme not proportionate. |
| F-37 test layers | **Fixed** | §13: adds RLS deny-all tests, draw concurrency, pagination completeness, DST gate, regen reconciliation, migration dry-run, iPad UAT checklist. |
| F-38 go-live runbook | **Fixed** | §14: step-ordered deploy per phase (expand schema → code → env vars → verify jobs → seed inactive → grants+FOH together → activate on a chosen business date). |
| F-40 kill switches | **Fixed** | §3.8: `module_enabled`, `generation_enabled`, `prompts_enabled`, `emails_enabled` in settings, changeable by superadmin without deploy, audited. |
| F-41 owners/estimates/sign-off | **Light** | §14: Peter approves each phase and the iPad UAT; everything else is the implementing developer. A RACI table for a two-person operation is ceremony. |
| F-42 degraded network | **Fixed** | §9.3: saving states, double-submit disabled, failure keeps input, poll-failure banner, explicit "if the iPad is offline use paper and tell Billy". |
| F-43 value rules | **Fixed** | §3.2.1: numeric(5,1), inclusive bounds, one-sided allowed, °C only in v1, exact typo-guard formula, correction behaviour and email key defined. |

## P2 / P3 and optional improvements

| # | Disposition | Where / why |
|---|-------------|-------------|
| F-44 todos too thin | **Adjusted** | §15: todos deferred to a one-page mini-spec before Phase 4 builds them. Removed from the Phase 4 deliverable claim. |
| F-45 index/query plans | **Light** | §3: indexes added for outbox (status, next_attempt_at), spot checks (business_date), todos (state, due_date). Response-time targets not set; volume is ~58 rows/day. |
| F-46 retention/backup | **Light** | §16: stated: no automated deletion in v1, Supabase managed backups, retention decision queued to the owner. |
| F-47 employee identity history | **Fixed** | §3: `ON DELETE RESTRICT`; employees are status-lifecycle, never hard-deleted in this app; leavers remain in history. |
| O-01 remove slot_due | **Fixed** | Merged into F-09. |
| O-02 narrow DB functions | **Adjusted** | §9.3/§11: the two genuinely concurrent writes (tick, draw) are RPCs; the rest stay server actions per house pattern. |
| O-03 defer floating + long cadences | **Rejected** | The 12 variable tasks are half the bar list's operational value and the floating engine is now fully specified. The seed values are owner-gated anyway (F-01), which gives the same protection without cutting the engine. |
| O-04 sticky attribution | **Fixed** | Merged into F-29. |
| O-05 provenance | **Fixed** | Merged into F-11 (generation runs). |
