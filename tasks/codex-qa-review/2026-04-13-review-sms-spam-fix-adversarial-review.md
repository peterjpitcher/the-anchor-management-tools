# Adversarial Review: Review SMS Spam Fix

**Date:** 2026-04-13
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex (4 Codex reviewers, 1 Claude reviewer)
**Scope:** `tasks/review-sms-spam-fix-spec.md` against codebase
**Spec:** `tasks/review-sms-spam-fix-spec.md`

## Inspection Inventory

### Inspected
- `src/app/api/cron/event-guest-engagement/route.ts` — full cron job including all review functions, cron locking, safety state
- `src/lib/sms/safety.ts` — `buildSmsDedupContext()`, `claimSmsIdempotency()`, `evaluateSmsSafetyLimits()`, all config defaults
- `src/lib/sms/safety-info.ts` — `extractSmsSafetyInfo()`
- `src/lib/twilio.ts` — `sendSMS()` full flow including idempotency, logging, quiet-hours
- `src/lib/sms/logging.ts` — `recordOutboundSmsMessage()` including fallback paths
- `src/lib/sms/review-once.ts` — `hasCustomerReviewed()` cross-channel suppression
- `src/lib/guest/tokens.ts` — `createGuestToken()` random token generation
- `src/app/r/[token]/route.ts` — review redirect handler, token validation, status transitions
- `src/lib/sms/__tests__/safety.test.ts` — existing test asserting body-sensitive requestHash
- `src/lib/parking/payments.ts`, `src/lib/events/waitlist-offers.ts`, `src/lib/events/event-payments.ts` — other URL-bearing SMS templates
- `src/app/api/cron/private-booking-monitor/route.ts` — private-booking review path (same pattern)
- `src/lib/manual-review-campaign-safety.ts` — stricter persistence pattern already in repo
- `supabase/migrations/` — enum values, column additions, squashed baseline
- `vercel.json` — cron schedule confirmation
- `.env.example` — default env var values

### Not Inspected
- Live Supabase data (Terry's booking, messages, idempotency_keys rows)
- Production environment variable overrides (especially `SMS_SAFETY_IDEMPOTENCY_TTL_HOURS`, `SMS_SAFETY_GUARDS_ENABLED`)
- Twilio delivery logs for the 17 messages
- Whether production database has all migrations applied

### Limited Visibility Warnings
- The exact cascade that produced 17 sends **cannot be reconstructed from code alone** — it requires runtime state verification
- Whether the `visited_waiting_for_review` enum value existed in production on April 11-12 is unverifiable from repo
- Whether per-recipient SMS limits were enabled/configured in production is unverifiable

## Executive Summary

The spec correctly identifies the two real code defects (token-before-send creating unique bodies, and bundled status+dedup flag update that fails together). However, the spec's root cause cascade is **incomplete and partially disproved**: the idempotency TTL theory is wrong (14-day default, not short-lived), and the spec cannot explain how 17 messages bypassed the per-recipient SMS safety limits (3/hour, 8/24h). The proposed Fix 2 (Option C — global URL normalisation) is **unsafe** and would break other SMS templates. Fix 4 (enum migration) is **stale** — the migration already exists. The spec also misses the private-booking review path (same bug), creates a stranded-booking lifecycle problem with Fix 1, and has no remediation plan for the customer.

## What Appears Solid

- **Core defect identification is correct**: Token creation before idempotency check (line 1150) and bundled status+dedup update (line 1211) are real code patterns confirmed by all reviewers
- **Fix 1 direction is correct**: Separating `review_sms_sent_at` from the status transition is the right approach — all reviewers agree
- **The dedup layer analysis is accurate**: `loadSentTableTemplateSet()` correctly queries `messages.table_booking_id + template_key`, and `buildSmsDedupContext()` does include body in requestHash
- **Cron schedule and eligibility logic are correctly documented**
- **Complexity score (M/3) is appropriate**

## Critical Risks

### CR-1: Spec cannot explain how 17 messages bypassed per-recipient SMS limits
**Type:** Strongly suspected defect in root cause analysis
**Severity:** Critical
**Confidence:** High
**Evidence:** `evaluateSmsSafetyLimits()` enforces 3 SMS/hour and 8 SMS/24h per recipient (safety.ts:79-81, 390, 399). These are checked in `sendSMS()` before idempotency (twilio.ts:261). 17 messages over 2 days (8 on day 1, 9 on day 2) should have been blocked after message 3 on each day — unless:
- Per-recipient limits were disabled in production (`SMS_SAFETY_GUARDS_ENABLED=false`)
- The limits key on `customer_id` not phone number (safety.ts:334), and Terry has multiple customer records
- Message logging failed, so the count query found no prior sends
**Engines:** Codex (Security + Repo Reality Mapper)
**Action:** Must verify production env vars and check if Terry has duplicate customer records before implementing fixes
**Blocking:** Yes — the fix is incomplete without understanding why existing guards failed

### CR-2: Fix 2 Option C (URL normalisation) is unsafe — breaks other templates
**Type:** Confirmed defect in spec
**Severity:** Critical
**Confidence:** High
**Evidence:** `buildSmsDedupContext()` is global across ALL SMS. URL stripping would suppress legitimate resends for: parking payment requests (parking/payments.ts:181), waitlist offers (events/waitlist-offers.ts:244), event payment links (events/event-payments.ts:433), table booking confirmations (table-bookings/bookings.ts:733). Existing test at safety.test.ts:110 explicitly asserts body-sensitive hashing.
**Engines:** All 5 reviewers flagged this independently
**Action:** Drop Option C entirely. The minimum viable fix is Fix 1 alone (dedup flag separation)
**Blocking:** Yes — must not ship as written

## Spec Defects

### SD-1: TTL expiry theory is disproved
The spec claims idempotency keys "expire between runs" as Bug 2. The default TTL is 14 days (safety.ts:82), not minutes. No in-repo cleanup cron calls the `cleanup_expired_idempotency_keys()` function. This theory does not hold unless production has a custom override.
**Action:** Remove Bug 2 from the spec. Note the 14-day TTL as evidence that idempotency IS working as designed — the problem is the `conflict` vs `duplicate` distinction, not expiry.

### SD-2: Fix 4 (enum migration) is stale
`visited_waiting_for_review` already exists in migration `20260420000003_bookings_v05_foundations.sql:191` (dated April 20, post-incident). The squashed baseline omits it, but the incremental migration adds it. A new migration is not needed.
**Action:** Remove Fix 4. Note that the enum was likely missing at incident time (April 11-12), which explains the status update failure — but it has since been fixed.

### SD-3: Missing private-booking review path
The private-booking monitor cron (`src/app/api/cron/private-booking-monitor/route.ts:852`) has the same pattern: random review token before send, persistence after send. The spec only addresses event and table booking paths.
**Action:** Add Fix 5 covering the private-booking review path.

### SD-4: No remediation plan for Terry
The spec has no cleanup plan for: (a) Terry's booking state, (b) the 17 orphaned guest tokens, (c) the idempotency key state.
**Action:** Add a remediation section with SQL to fix Terry's booking and clean up tokens.

### SD-5: Spec doesn't address why existing guards failed
The per-recipient SMS limits (3/hour, 8/24h), the messages-table sentSet, and the idempotency layer all should have prevented this. The spec must explain why each failed in order for the fix to be trustworthy.
**Action:** Add a "Why existing guards failed" section. The most likely explanation: message logging failed (missing `table_booking_id`/`template_key` columns at incident time), which meant (a) sentSet found nothing, (b) per-recipient counts were zero, and (c) idempotency conflicted but couldn't prevent the next run from trying again.

## Implementation Defects

### ID-1: Fix 1 sample code doesn't handle zero-rows-updated
The proposed `.is('review_sms_sent_at', null)` update can succeed with zero rows affected (already set by a concurrent run). The spec only checks `sentAtError`, not whether data was returned.
**Action:** Add `.select('id').maybeSingle()` and check for null data, same as the current status update pattern.

### ID-2: Fix 1 creates stranded bookings in lifecycle
Setting `review_sms_sent_at` without transitioning status to `visited_waiting_for_review` means `processReviewWindowCompletion()` (line 1302) and `processTableReviewWindowCompletion()` (line 1362) won't find these bookings — they only process `visited_waiting_for_review` / `review_clicked` status. Bookings get stuck in `confirmed` forever (unless the customer clicks the review link, which transitions to `review_clicked`).
**Action:** The status transition should still be attempted after the dedup flag. If it fails, log an error (not just a warning) so it can be investigated. Consider a periodic cleanup that transitions `confirmed` bookings with `review_sms_sent_at` set to the correct status.

### ID-3: Event-booking Fix 1 must preserve `review_window_closes_at`
The event-booking path (processReviewFollowups) sets `review_window_closes_at` alongside the status change. This field is consumed by `processReviewWindowCompletion()` (line 1299). If the split update doesn't persist it, lifecycle completion breaks.
**Action:** Set `review_window_closes_at` in the same update as `review_sms_sent_at`, not with the status transition.

## Workflow & Failure-Path Defects

### WF-1: Cron timeout between SMS send and dedup flag update
With `maxDuration = 300` and up to 50 bookings per run, a Vercel timeout after sending SMS but before updating `review_sms_sent_at` would leave the booking eligible. Fix 1 narrows this window but doesn't eliminate it.
**Action:** Accept as residual risk. The idempotency layer (14-day TTL) provides secondary protection. Document this in the spec.

### WF-2: `logging_failed` path creates orphaned guest tokens
When `sendSMS` returns `success: true, logFailure: true`, the cron proceeds past the `!smsResult.success` check (line 1187) without cleaning up the token. The SMS was sent, the token exists, but the message isn't logged.
**Action:** Add token cleanup in the `logging_failed` path, or accept as low-priority since the token expires.

## Security & Data Risks

### SR-1: 17 orphaned active review tokens for Terry's booking
Each duplicate send created a new `review_redirect` guest token. `createGuestToken()` always inserts fresh (tokens.ts:32). There's no one-token-per-booking constraint. All 17 tokens may still be valid until they expire (8 days from creation).
**Action:** Add cleanup SQL to remediation plan. Consider adding a unique constraint on `(table_booking_id, action_type)` for review tokens.

### SR-2: Per-recipient SMS limits key on customer_id not phone number
If Terry has multiple customer records for the same phone number, each gets its own rate limit bucket. This could explain how limits were bypassed.
**Action:** Verify in production whether duplicate customer records exist. Consider adding phone-number-level rate limiting as defense in depth.

## Unproven Assumptions

| # | Assumption | What would confirm/deny |
|---|-----------|------------------------|
| 1 | The `visited_waiting_for_review` enum was missing in production on April 11-12 | Check Supabase migration history on production |
| 2 | Message logging was failing (missing columns) | Check production `messages` table for Terry's booking — if no rows with `table_booking_id`, logging was broken |
| 3 | Per-recipient SMS limits were enabled | Check `SMS_SAFETY_GUARDS_ENABLED` env var in production |
| 4 | Terry has only one customer record | Query `customers` by phone number `+44737950051` |
| 5 | The idempotency table was functional | Check `idempotency_keys` for entries matching Terry's booking |

## Recommended Fix Order

1. **Investigate production state first** (assumptions 1-5 above) — the fix is incomplete without understanding which guards failed
2. **Fix 1 (revised)**: Split `review_sms_sent_at` from status change, handle zero-rows, preserve `review_window_closes_at` for events
3. **Drop Fix 2 Option C** — unsafe for other templates. The dedup flag separation (Fix 1) is the minimum viable fix
4. **Drop Fix 4** — enum migration already exists
5. **Add Fix 5**: Apply same pattern to private-booking review path
6. **Remediate Terry**: SQL to set `review_sms_sent_at`, clean up orphaned tokens, verify booking state
7. **Add per-phone-number rate limiting** as defense in depth (separate PR)

## Follow-Up Review Required

- Re-review Fix 1 implementation after coding — verify zero-rows handling and lifecycle compatibility
- Verify production investigation results before finalising the root cause analysis
- Review private-booking review path fix (new scope)
