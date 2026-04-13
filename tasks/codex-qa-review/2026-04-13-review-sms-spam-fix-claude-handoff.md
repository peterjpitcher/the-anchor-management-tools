# Claude Hand-Off Brief: Review SMS Spam Fix

**Generated:** 2026-04-13
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** High — spec has correct direction but critical gaps and one unsafe fix

## DO NOT REWRITE

- The core defect identification: token-before-send and bundled status+dedup update
- The analysis of `buildSmsDedupContext()` hashing behaviour (dedupeKey stable, requestHash body-sensitive)
- The `claimSmsIdempotency()` flow analysis (duplicate vs conflict distinction)
- The eligibility filter analysis (status='confirmed' + review_sms_sent_at IS NULL)
- The `loadSentTableTemplateSet()` dedup layer analysis
- The affected files list (route.ts, safety.ts, logging.ts, twilio.ts)
- The complexity score (M/3)

## SPEC REVISION REQUIRED

- [ ] **SPEC-1**: Remove Bug 2 (TTL expiry theory) — disproved. Default TTL is 14 days (safety.ts:82). Replace with: "The idempotency layer correctly blocks run 2 as `conflict`, but the root cause is upstream — the booking remains eligible because `review_sms_sent_at` was never set."

- [ ] **SPEC-2**: Remove Fix 2 Option C (URL normalisation) entirely — unsafe. `buildSmsDedupContext()` is global; stripping URLs breaks parking payments, waitlist offers, event payments, and other legitimate resend scenarios. Existing test at safety.test.ts:110 explicitly asserts body-sensitive hashing. **The minimum viable fix is Fix 1 alone.**

- [ ] **SPEC-3**: Remove Fix 4 (enum migration) — already exists in `20260420000003_bookings_v05_foundations.sql:191`. Note that the enum was likely missing at incident time (April 11-12), explaining the status update failure, but has since been added.

- [ ] **SPEC-4**: Add "Why existing guards failed" section explaining:
  - Per-recipient SMS limits (3/hr, 8/24h) should have blocked at message 3 — investigate production env vars and duplicate customer records
  - `loadSentTableTemplateSet()` should have caught run 2 — investigate whether `messages.table_booking_id`/`template_key` columns existed at incident time (migration adding them is dated April 20)
  - Idempotency layer should have blocked run 2 as `conflict` — investigate whether the idempotency_keys table was functional

- [ ] **SPEC-5**: Add Fix 5 for private-booking review path (`src/app/api/cron/private-booking-monitor/route.ts:852`) — same token-before-send pattern, same bundled persistence.

- [ ] **SPEC-6**: Add remediation plan for Terry: SQL to set `review_sms_sent_at` on the booking, clean up orphaned `guest_tokens` (17 `review_redirect` tokens), verify booking lifecycle state.

- [ ] **SPEC-7**: Revise the root cause cascade — the current 3-bug cascade is not code-consistent for 17 sends. The most likely explanation involves message logging failure (missing columns at incident time) disabling both the sentSet guard AND per-recipient rate limits (which count `messages` rows).

## IMPLEMENTATION CHANGES REQUIRED

- [ ] **IMPL-1**: `src/app/api/cron/event-guest-engagement/route.ts` — `processTableReviewFollowups()`: Split the update at lines 1211-1236 into two steps:
  1. Set `review_sms_sent_at` + `updated_at` with `.is('review_sms_sent_at', null).select('id').maybeSingle()`
  2. Check both error AND null data (zero rows = already set or concurrent run)
  3. Then attempt status transition to `visited_waiting_for_review` separately
  4. Log error (not warn) if status transition fails after dedup flag succeeds

- [ ] **IMPL-2**: `src/app/api/cron/event-guest-engagement/route.ts` — `processReviewFollowups()`: Same split pattern but ALSO set `review_window_closes_at` in the first update alongside `review_sms_sent_at` (consumed by `processReviewWindowCompletion()` at line 1299)

- [ ] **IMPL-3**: `src/app/api/cron/private-booking-monitor/route.ts` — Apply same dedup flag separation to the private-booking review send at line ~852

- [ ] **IMPL-4**: Do NOT modify `src/lib/sms/safety.ts` — `buildSmsDedupContext()` must remain unchanged. The body-sensitive requestHash is intentional and correct.

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1**: Was `SMS_SAFETY_GUARDS_ENABLED` set to `false` in production on April 11-12? → Check Vercel env vars. If guards were off, the per-recipient limits wouldn't have run.

- [ ] **ASM-2**: Does Terry have multiple customer records for `+44737950051`? → Query `SELECT id, first_name, last_name, mobile_number FROM customers WHERE mobile_number LIKE '%7379500%'`. Multiple records = multiple rate limit buckets.

- [ ] **ASM-3**: Were `messages.table_booking_id` and `messages.template_key` columns present in production on April 11-12? → The migration adding them (`20260420000003`) is dated April 20. If they didn't exist, `loadSentTableTemplateSet()` would have thrown, been caught, and triggered a safety abort — but `recordOutboundSmsMessage()` would also fail to log the dedicated columns, meaning per-recipient counts found zero sends.

- [ ] **ASM-4**: Was the `idempotency_keys` table functional? → Check `SELECT * FROM idempotency_keys WHERE key LIKE '%table_review_followup%' ORDER BY created_at DESC LIMIT 20`

## REPO CONVENTIONS TO PRESERVE

- `sendSmsSafe()` wrapper pattern — catches errors from `sendSMS()` and returns generic `{success: false}`
- `maybeRecordFatalSmsSafetyAbort()` pattern — extracts safety signals and records aborts
- `safety.throwSafetyAbort()` pattern — stops processing on fatal signals
- Existing test at `safety.test.ts:110` — body-sensitive requestHash must be preserved
- `logger.warn` for non-fatal failures, `logger.error` for data-integrity risks

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] **CR-1**: Re-review after production investigation — root cause analysis depends on runtime state
- [ ] **ID-1**: Re-review Fix 1 implementation for zero-rows handling
- [ ] **ID-2**: Re-review lifecycle compatibility — confirm stranded bookings are handled
- [ ] **ID-3**: Re-review event-booking fix for `review_window_closes_at` preservation
- [ ] **IMPL-3**: Re-review private-booking fix (new scope, not in original spec)

## REVISION PROMPT

You are revising the Review SMS Spam Fix spec based on an adversarial review.

Apply these changes in order:

1. **Remove** Bug 2 (TTL expiry) — replace with explanation that idempotency blocks as `conflict` but booking remains eligible due to missing dedup flag
2. **Remove** Fix 2 Option C (URL normalisation) — unsafe for other templates. Fix 1 alone is the minimum viable fix.
3. **Remove** Fix 4 (enum migration) — already exists post-incident
4. **Add** "Why existing guards failed" section — investigate message logging failure as the root enabler
5. **Add** Fix 5 for private-booking review path
6. **Add** remediation plan for Terry (booking state, orphaned tokens)
7. **Revise** Fix 1 sample code: add `.select('id').maybeSingle()`, check null data, preserve `review_window_closes_at` for events
8. **Add** assumptions that need production verification before the cascade is confirmed

After applying changes, confirm:
- [ ] All spec revisions applied
- [ ] Fix 2 Option C completely removed
- [ ] Fix 4 completely removed
- [ ] Private-booking path added
- [ ] Remediation plan added
- [ ] Fix 1 sample code handles zero-rows
- [ ] Event-booking fix preserves review_window_closes_at
- [ ] Assumptions flagged for human review
