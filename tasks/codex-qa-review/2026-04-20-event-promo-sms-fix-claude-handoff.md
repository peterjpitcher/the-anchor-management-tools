# Claude Hand-Off Brief: Event Promo SMS Fix

**Generated:** 2026-04-20
**Review mode:** A (Adversarial Challenge)
**Overall risk:** Medium (spec is sound; one pre-deploy verification needed)

## DO NOT REWRITE

- The three-bug diagnosis is confirmed correct against production state
- The `processFollowUps` ordering (3d before 7d before crossPromo) is intentional
- The `hasReachedDailyPromoLimit` + `sms_promo_context` frequency cap + budget counter are all correct safety nets
- The backfill `ON CONFLICT DO NOTHING` approach is safe for the unique constraint
- The `audience_type || 'category_match'` fallback at cross-promo.ts:378 handles both pools correctly
- The TypeScript type `CrossPromoAudienceRow` already matches the 6-param return signature

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **Verify general_promo templates:** Read `cross-promo.ts` send function to confirm `event_general_promo_14d` and `event_general_promo_14d_paid` message builders produce customer-appropriate copy. These have never fired in production.
- [ ] **Migration timestamp ordering:** Ensure DROP overload migration has an earlier timestamp than the backfill migration (both in same `db push`).
- [ ] **DROP FUNCTION without CASCADE:** Use `DROP FUNCTION` (not `DROP FUNCTION ... CASCADE`) so it fails loudly if unexpected dependents exist rather than silently cascading.

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-001:** Are the `event_general_promo_14d` / `_paid` templates production-ready? Check the message builder in `cross-promo.ts` for the general-pool send path.

## REPO CONVENTIONS TO PRESERVE

- Migration filenames: `YYYYMMDDHHMMSS_descriptive_name.sql` (use next available timestamp after `20260615000000`)
- Function audit before DROP: grep all migrations + src for references (per `.claude/rules/supabase.md`)
- Service-role client only for promo operations (no anon-key access to promo tables)
- Logger calls with `metadata` object for structured logging

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **DEFECT-001:** After verifying templates, confirm the general-pool send path produces appropriate SMS copy
- [ ] Post-deploy: confirm `promo_sequence` has rows and `sms_promo_context` shows new template keys

## REVISION PROMPT

```
Implement the event promo SMS fix per tasks/event-promo-sms-fix-spec.md with these adjustments from QA review:

1. Before writing migrations, read cross-promo.ts lines 90-180 to verify the general_promo template message builders have real customer-ready copy (not placeholder text).

2. Migration 1 (timestamp 20260616000000): DROP FUNCTION without CASCADE:
   DROP FUNCTION IF EXISTS public.get_cross_promo_audience(UUID, UUID, INT, INT, INT);
   Then re-REVOKE/GRANT on the remaining 6-param version.

3. Migration 2 (timestamp 20260616000001): Backfill as specified in the spec.

4. Code changes as specified in the spec:
   - cross-promo.ts:242 — pass all 6 params
   - route.ts:1647 — compute timestamptz

5. After implementation, run the verification pipeline (lint, typecheck, build).
```
