# Review SMS Spam Fix — Specification (v2, post-adversarial review)

## Problem Statement

On 11–12 April 2026, customer Terry Leigh (+44737950051) received **17 duplicate** "quick review" SMS messages after a single table booking for 4 on Sat 11 Apr at 12:00. The messages arrived in 15-minute bursts across two days, each with a unique short link — confirming that the cron ran and sent a new message on almost every invocation.

This is a critical customer-facing bug that erodes trust, wastes SMS credits, and may violate messaging regulations around consent and frequency.

## Affected Code

| File | Function | Role |
|------|----------|------|
| `src/app/api/cron/event-guest-engagement/route.ts` | `processTableReviewFollowups()` (line 1070) | Sends table-booking review request SMS |
| `src/app/api/cron/event-guest-engagement/route.ts` | `processReviewFollowups()` (line 832) | Sends event-booking review request SMS (same pattern) |
| `src/app/api/cron/event-guest-engagement/route.ts` | `loadTableBookingsForEngagement()` (line 653) | Fetches eligible bookings — filters `status = 'confirmed'` |
| `src/app/api/cron/private-booking-monitor/route.ts` | Review send (~line 852) | Sends private-booking review SMS (same pattern) |
| `src/lib/sms/safety.ts` | `buildSmsDedupContext()` (line 120) | Builds idempotency key + request hash |
| `src/lib/twilio.ts` | `sendSMS()` (line ~250) | Orchestrates dedup check → Twilio send → message logging |
| `src/lib/sms/logging.ts` | `recordOutboundSmsMessage()` (line 26) | Persists message to `messages` table |

## Root Cause Analysis

### Why existing guards failed — the real cascade

The codebase has 6 layers of deduplication/protection. At incident time (April 11-12), **most were non-functional** due to missing database columns:

| Layer | Guard | Status at incident time | Why it failed |
|-------|-------|------------------------|---------------|
| 1 | `loadTableBookingsForEngagement()` filters `status='confirmed'` | **Failed** | Status update to `visited_waiting_for_review` failed because the enum value didn't exist yet (migration `20260420000003` dated April 20) |
| 2 | Eligibility filter checks `review_sms_sent_at` (line 1082) | **Failed** | `review_sms_sent_at` is bundled with the status update — when the status change fails, the flag is also not set |
| 3 | `loadSentTableTemplateSet()` checks `messages` table (line 1092) | **Failed** | `messages.table_booking_id` and `messages.template_key` columns didn't exist yet (same April 20 migration). Query either failed or returned empty. |
| 4 | `buildSmsDedupContext()` → idempotency (line 1165) | **Bypassed entirely** | `buildSmsDedupContext()` returns `null` when `template_key` is not in metadata. Since `template_key` wasn't a column on `messages`, the metadata may not have contained it as expected, OR the logging path that mirrors metadata into dedicated columns would fail. Either way, the idempotency system was effectively disabled. |
| 5 | Per-recipient SMS limits (3/hr, 8/24h) | **Failed** | `evaluateSmsSafetyLimits()` counts from the `messages` table. If logging failed or was incomplete (missing columns), counts were zero — all limits passed. |
| 6 | `hasCustomerReviewed()` cross-channel check | **Ineffective** | Only suppresses after a customer has clicked a review link — doesn't prevent pre-click spam. |

**Additionally:** There is no unique constraint on `customers.mobile_number` (only on `mobile_e164` which may not be backfilled). If Terry has duplicate customer records, each gets its own rate limit bucket.

### The confirmed code defects (still present)

Even though the missing columns have since been added (April 20 migration), two code defects remain that would cause the same bug if any dedup layer fails:

#### Defect 1: `review_sms_sent_at` bundled with status change (PRIMARY FIX TARGET)

**Location:** `processTableReviewFollowups()` lines 1211–1236

After sending the SMS, the code does a single conditional update:

```typescript
const { data: updatedTableBooking, error: tableBookingUpdateError } = await supabase
  .from('table_bookings')
  .update({
    status: 'visited_waiting_for_review',
    review_sms_sent_at: reviewSentAt,
    updated_at: new Date().toISOString()
  })
  .eq('id', booking.id)
  .eq('status', 'confirmed')
  .select('id')
  .maybeSingle()
```

If this update fails for any reason (enum missing, race condition, transient error), **both** the lifecycle transition and the dedup flag are lost. The booking remains eligible for the next cron run.

#### Defect 2: Guest token created before send (SECONDARY — creates orphaned tokens)

**Location:** `processTableReviewFollowups()` lines 1150–1156

Each cron run creates a new random guest token before `sendSmsSafe`. If the send is blocked or the booking is re-processed, orphaned tokens accumulate. With the idempotency system now functional (post April 20 migration), this causes `conflict` returns rather than `duplicate` (because the body differs per run), which aborts the entire cron run — a denial-of-service on the cron job for other bookings.

### Historical cascade (April 11-12)

```
Every cron run (every 15 minutes):
  1. Fetch bookings where status='confirmed' → Terry's booking found (status never changed)
  2. review_sms_sent_at is null → eligible (never set due to bundled update)
  3. sentSet check → empty (messages.table_booking_id column didn't exist)
  4. Idempotency check → skipped (buildSmsDedupContext returned null)
  5. Per-recipient limits → passed (message count was zero in messages table)
  6. Create guest token → unique URL → SMS SENT
  7. Status update fails (visited_waiting_for_review enum didn't exist)
  8. review_sms_sent_at NOT set → booking remains eligible
  → Repeat next run
```

## Fix Specification

### Fix 1: Set `review_sms_sent_at` independently of status change (CRITICAL)

**Rationale:** The dedup flag must survive independently of the lifecycle transition. This is the minimum viable fix — it prevents re-eligibility even when other guards fail.

**Change in `processTableReviewFollowups()` (lines 1208–1236):**

```typescript
const reviewSentAt = smsResult.scheduledFor || new Date().toISOString()
const reviewWindowClosesAt = new Date(Date.parse(reviewSentAt) + 7 * 24 * 60 * 60 * 1000).toISOString()

// STEP 1: Set the dedup flag — this is the primary guard against re-sends
const { data: flaggedBooking, error: sentAtError } = await supabase
  .from('table_bookings')
  .update({
    review_sms_sent_at: reviewSentAt,
    updated_at: new Date().toISOString()
  })
  .eq('id', booking.id)
  .is('review_sms_sent_at', null)
  .select('id')
  .maybeSingle()

if (sentAtError || !flaggedBooking) {
  // Hard failure or concurrent run already set it — either way, abort safely
  logger.error('CRITICAL: SMS sent but failed to set review_sms_sent_at dedup flag', {
    metadata: {
      tableBookingId: booking.id,
      customerId: customer.id,
      error: sentAtError?.message ?? 'zero rows updated',
      alreadyFlagged: !sentAtError && !flaggedBooking
    }
  })
  if (sentAtError) {
    safety.recordSafetyAbort({
      stage: 'table_reviews:dedup_flag',
      bookingId: null,
      tableBookingId: booking.id,
      customerId: customer.id,
      eventId: null,
      templateKey: TEMPLATE_TABLE_REVIEW_FOLLOWUP,
      code: 'dedup_flag_failed',
      logFailure: false,
    })
  }
  result.sent += 1
  if (safety.primaryAbort) {
    safety.throwSafetyAbort()
  }
  continue  // Don't attempt status change if flag failed
}

// STEP 2: Lifecycle status transition — desirable but not critical for dedup
const { data: updatedTableBooking, error: statusError } = await supabase
  .from('table_bookings')
  .update({
    status: 'visited_waiting_for_review',
    updated_at: new Date().toISOString()
  })
  .eq('id', booking.id)
  .eq('status', 'confirmed')
  .select('id')
  .maybeSingle()

if (statusError) {
  logger.error('Table booking status transition failed after review SMS (dedup flag IS set)', {
    metadata: { tableBookingId: booking.id, error: statusError.message }
  })
} else if (!updatedTableBooking) {
  logger.warn('Table booking status transition affected no rows (status may have changed)', {
    metadata: { tableBookingId: booking.id }
  })
}
```

### Fix 2: Apply same pattern to event-booking reviews

**Location:** `processReviewFollowups()` lines 983–1000

Same split pattern, but **also set `review_window_closes_at` in the first update** alongside `review_sms_sent_at`. This field is consumed by `processReviewWindowCompletion()` (line 1299) and must not be lost if the status transition fails.

```typescript
// STEP 1: Dedup flag + review window (both needed for lifecycle)
const { data: flaggedBooking, error: sentAtError } = await supabase
  .from('bookings')
  .update({
    review_sms_sent_at: reviewSentAt,
    review_window_closes_at: reviewWindowClosesAt,
    updated_at: new Date().toISOString()
  })
  .eq('id', booking.id)
  .is('review_sms_sent_at', null)
  .select('id')
  .maybeSingle()

// STEP 2: Status transition (same as Fix 1 pattern)
```

### Fix 3: Apply same pattern to private-booking reviews

**Location:** `src/app/api/cron/private-booking-monitor/route.ts` (~line 852)

The private-booking review path has the identical bug: random token before send, persistence after send with `review_processed_at`. Apply the same dedup-flag-first pattern.

### Fix 4: Terry remediation

Fix Terry's booking state and clean up orphaned tokens:

```sql
-- 1. Set review_sms_sent_at on Terry's booking to prevent further sends
UPDATE table_bookings
SET review_sms_sent_at = '2026-04-11T16:00:00Z',
    status = 'visited_waiting_for_review',
    updated_at = NOW()
WHERE customer_id = (
  SELECT id FROM customers
  WHERE mobile_number LIKE '%7379500%'
  LIMIT 1
)
AND booking_date = '2026-04-11'
AND review_sms_sent_at IS NULL;

-- 2. Clean up orphaned review tokens for Terry's booking
DELETE FROM guest_tokens
WHERE action_type = 'review_redirect'
AND table_booking_id IN (
  SELECT id FROM table_bookings
  WHERE customer_id = (
    SELECT id FROM customers WHERE mobile_number LIKE '%7379500%' LIMIT 1
  )
  AND booking_date = '2026-04-11'
);

-- 3. Check for duplicate customer records
SELECT id, first_name, last_name, mobile_number, mobile_e164
FROM customers
WHERE mobile_number LIKE '%7379500%' OR mobile_e164 LIKE '%7379500%';
```

## Files to Modify

| File | Change |
|------|--------|
| `src/app/api/cron/event-guest-engagement/route.ts` | Split status update from dedup flag for both `processTableReviewFollowups` and `processReviewFollowups`. Handle zero-rows-updated. Preserve `review_window_closes_at` for events. |
| `src/app/api/cron/private-booking-monitor/route.ts` | Same split pattern for private-booking review send |

**NOT modified:** `src/lib/sms/safety.ts` — `buildSmsDedupContext()` body-sensitive hashing is intentional and correct. Must not strip URLs globally.

## What was dropped from v1 (and why)

| v1 item | Dropped because |
|---------|----------------|
| Fix 2 Option C (URL normalisation) | Unsafe — breaks parking payments, waitlist offers, and other templates. All 5 adversarial reviewers flagged this. |
| Fix 4 (enum migration) | Already exists in `20260420000003_bookings_v05_foundations.sql:191` (dated April 20, post-incident). |
| Bug 2 (TTL expiry theory) | Disproved — default TTL is 14 days (safety.ts:82). No cleanup cron exists. Keys don't expire between 15-minute runs. |

## Testing Plan

1. **Unit test dedup flag separation**: Verify `review_sms_sent_at` is set even when status transition is rejected (mock Supabase to fail the second update)
2. **Unit test zero-rows handling**: Verify that when `.maybeSingle()` returns null (concurrent run), the code handles gracefully
3. **Unit test event path**: Verify `review_window_closes_at` is set alongside `review_sms_sent_at` in the first update
4. **Manual verification**: Run Terry remediation SQL, confirm booking state is correct
5. **Manual verification**: Check for duplicate customer records for Terry's phone number

## Success Criteria

- A customer with a completed table booking receives **exactly one** review SMS
- If the status transition fails, `review_sms_sent_at` is still set (prevents re-eligibility)
- Event-booking path preserves `review_window_closes_at` independently of status
- Same fix applied to all three review paths (table, event, private)
- No regression in review SMS functionality for new bookings
- Terry's booking remediated

## Complexity Score

**3 (M)** — 2 cron route files changed, moderate logic changes, remediation SQL. No schema changes needed (columns and enums already exist).

## Risk Assessment

- **Low risk**: Splitting the status update — existing transition still attempted, just decoupled from dedup flag
- **Low risk**: Zero-rows handling — conservative approach (log + continue)
- **Medium risk**: Stranded bookings — if status transition fails, booking stays `confirmed` with `review_sms_sent_at` set. `processTableReviewWindowCompletion()` won't find it. Mitigation: the review link redirect route (`r/[token]/route.ts`) can transition `confirmed` → `review_clicked`, which the completion job does process. Worst case: booking ages out naturally.
- **Low risk**: Private-booking path — same pattern, lower volume
