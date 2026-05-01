# Adversarial Review: Event Promo SMS Pipeline Fix

**Date:** 2026-04-20
**Mode:** A (Adversarial Challenge)
**Scope:** Spec at `tasks/event-promo-sms-fix-spec.md` + source files
**Pack:** `tasks/codex-qa-review/2026-04-20-event-promo-sms-fix-review-pack.md`

**Note:** Codex reviewers received a pack with no diff (fix is spec-only, not yet on a branch). Findings below are synthesised from direct source inspection against the adversarial framework.

## Executive Summary

The spec correctly identifies all three root causes and proposes sound fixes. However, there are **two gaps** that would cause the fix to partially fail on first deploy, and **one assumption** that needs verification before the backfill migration runs.

## What Appears Solid

1. **Bug 1 diagnosis is correct.** Prod confirms two overloaded signatures for `get_cross_promo_audience`. The 6-param `CREATE OR REPLACE` did NOT replace the 5-param (different arity). PostgREST PGRST203 is the expected failure mode.

2. **Bug 2 diagnosis is correct.** `get_follow_up_recipients` declares `p_min_gap_iso TIMESTAMPTZ`; caller passes `"7 days"` string → error 22007. The fix (compute a timestamp N days in the past) matches the function's comparison logic (`ps.touch_14d_sent_at <= p_min_gap_iso`).

3. **Bug 3 diagnosis is correct.** `promo_sequence` created after all historical sends. Empty table confirmed in prod. Backfill from `sms_promo_context` is the right source.

4. **Safety analysis is sound.** Existing guards (hourly cap, daily limit, frequency check, budget counter, time budget) are real and will prevent runaway sends.

5. **Blast radius estimate is reasonable.** ≤50 SMS on first run, all dedup-protected.

## Critical Risks

### RISK-001: Backfill uses wrong column for promo_sequence.audience_type (BLOCKING)

**Severity:** High | **Confidence:** High

The spec backfill hardcodes `'category_match'` for all historical sends:
```sql
INSERT INTO promo_sequence (customer_id, event_id, audience_type, touch_14d_sent_at)
SELECT spc.customer_id, spc.event_id, 'category_match', spc.created_at
FROM sms_promo_context spc ...
```

This is correct for pre-migration sends (only category pool existed). But the `audience_type` column is `NOT NULL` in `promo_sequence` — and after the fix, the 6-param RPC returns both `category_match` and `general_recent` rows. The spec's caller update at `cross-promo.ts:242` will start getting `general_recent` audience rows. The INSERT at line 374 uses `recipient.audience_type || 'category_match'` — this works.

**Verdict:** Not actually blocking. The fallback `|| 'category_match'` handles it. The backfill hardcoding is correct for historical data.

### RISK-002: The 6-param RPC returns different columns than the TypeScript type expects (BLOCKING)

**Severity:** High | **Confidence:** High

The **5-param** version returns: `customer_id, first_name, last_name, phone_number, last_event_category, times_attended`

The **6-param** version returns: `customer_id, first_name, last_name, phone_number, last_event_category, times_attended, audience_type, last_event_name`

The TypeScript type `CrossPromoAudienceRow` at `cross-promo.ts:32-41` already includes `audience_type` and `last_event_name`. So the type is aligned with the 6-param version. The code at line 255 casts: `(audience as CrossPromoAudienceRow[] | null)`.

**Verdict:** Not blocking. Type is already correct for 6-param version.

### RISK-003: DROP FUNCTION may fail if dependent objects exist

**Severity:** Medium | **Confidence:** Medium

The spec's migration runs `DROP FUNCTION IF EXISTS public.get_cross_promo_audience(UUID, UUID, INT, INT, INT)`. If any trigger, view, or policy references this specific signature, the DROP will fail with a dependency error.

**Evidence:** The 5-param version was only called from `cross-promo.ts` via PostgREST (not from other SQL functions). No PL/pgSQL functions reference it (checked via `information_schema.routines`). The `REVOKE` in the original migration only grants to `service_role`.

**Verdict:** Low risk but add `CASCADE` consideration. Recommend using plain `DROP FUNCTION` (without CASCADE) so it fails loudly if something unexpected depends on it, rather than silently cascading.

## Implementation Defects

### DEFECT-001: Spec omits the `general_promo` template path (Medium)

The 6-param RPC returns `audience_type = 'general_recent'` for the general pool. The code at `cross-promo.ts:19-21` has templates:
- `TEMPLATE_GENERAL_PROMO_FREE = 'event_general_promo_14d'`
- `TEMPLATE_GENERAL_PROMO_PAID = 'event_general_promo_14d_paid'`

These templates are selected based on `audience_type` in the send logic. After the fix, `general_recent` recipients will receive the general template (different wording from category-match). The spec doesn't mention verifying these templates exist and are appropriate. If they're never been used, they might have placeholder text.

**Action:** Verify template content in the send function before deploy.

### DEFECT-002: Migration ordering matters (Low)

The spec proposes two migrations:
1. Drop 5-param overload
2. Backfill promo_sequence

These must be applied in this order. If the backfill runs first, it works fine (no dependency). If the drop runs first, cross-promo starts working immediately but follow-ups have no data until backfill completes. Since Supabase applies migrations in filename order and both will be in the same push, this is fine — just ensure timestamp ordering.

**Action:** Ensure migration timestamps are sequential (drop first, then backfill).

## Workflow & Failure-Path Defects

### WF-001: First run after fix may send both 14d AND 3d to the same customers (Medium)

**Scenario:** Music Bingo is 4 days out. After the fix:
- `processCrossPromo` runs (14d stage) — Music Bingo is within 14d window but `sms_promo_context` dedup prevents re-sending to the 7 existing recipients. New general-pool recipients (~26) get a 14d intro.
- `processFollowUps('3d', 2, 4, 7, ...)` runs — the backfilled promo_sequence rows have `touch_14d_sent_at` from 10 days ago (≥7 day gap). These 7 customers get a 3d follow-up.

**Problem:** The newly-sent 14d general-pool recipients (from this same run) WON'T get a 3d follow-up in this run because:
1. Their `promo_sequence` row was just created moments ago
2. `minGapDays=7` means they need a 7-day gap since touch_14d — they have 0 days

**Verdict:** This is actually correct behaviour. The 3d stage fires for the backfilled rows, and new recipients start their sequence fresh. No double-send.

BUT: `hasReachedDailyPromoLimit` could block the 3d follow-up if the same customer somehow got a promo earlier that day. Since the 3d stage runs BEFORE crossPromo in the code (line 1899 before 1905), this is fine — 3d runs first.

### WF-002: The 14-day cleanup deletes promo_sequence rows that may still need 3d follow-up (Low)

As noted in the spec: 14d touch → 3d follow-up at day 11 → 3 days of buffer before 14-day cleanup. This is tight but acceptable for normal operations. Edge case: if the cron stops running for 3+ days (Vercel outage), rows could age out before follow-ups fire.

**Action:** Non-blocking. Document the 3-day buffer as a known constraint.

## Unproven Assumptions

### ASM-001: The `general_recent` template wording is production-ready

The `event_general_promo_14d` and `event_general_promo_14d_paid` templates have never been sent (all 41 historical sends used `event_cross_promo_14d`). These templates may contain placeholder text, developer test content, or awkward wording that shouldn't go to customers.

**What would confirm:** Read the message builder function that uses these template keys in `cross-promo.ts` and verify the copy is appropriate.

### ASM-002: The Bingo 29 Apr event will correctly receive new 14d sends

The spec assumes Bingo 29 Apr (9 days out) is within the 14d cross-promo window. `loadUpcomingEventsForPromo` uses `date IN (today...today+14d)`. 9 days out is within 14 days. But this event already has 12 `sms_promo_context` rows (from the Apr 15 batch). New sends will go to the general pool only (category-match recipients already received).

**What would confirm:** Run the 6-param RPC for Bingo 29 Apr and check how many general-pool recipients it returns after excluding the 12 existing.

## Recommended Fix Order

1. **Verify templates** — read the general_promo message builders (non-blocking but do first)
2. **Migration 1** — drop 5-param overload (unblocks cross-promo immediately)
3. **Migration 2** — backfill promo_sequence (enables follow-ups)
4. **Code change 1** — update cross-promo.ts caller to pass 6 params
5. **Code change 2** — fix route.ts timestamptz computation
6. **Deploy** — single deploy, all changes together
7. **Verify** — trigger cron, check logs and DB for new sends

## Minor Observations

- The `as never` type cast at route.ts:1908/1913 (cleanup queries) suggests the Supabase types don't include `promo_sequence`/`sms_promo_context` in the generated schema. Not blocking but indicates types are stale.
- The spec's `p_max_recipients: 200` is double the original default (100). This is intentional (6-param version sets a higher default for the combined pool). Correct.
- Route.ts line 1899 processes 3d BEFORE 7d. This is by design (3d is higher priority, gets budget first). Not a defect.
