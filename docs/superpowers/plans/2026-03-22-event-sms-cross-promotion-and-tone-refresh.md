# Event SMS Cross-Promotion & Tone Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cross-event promotion SMS with reply-to-book, refresh the tone of all SMS messages, and add a review-once rule to prevent repeat review requests.

**Architecture:** 5 independent phases: tone refresh (string changes), review-once rule (schema + cron logic), booking service extraction (refactor), cross-promotion engine (new cron stage + RPC + table), reply-to-book (webhook extension). Phases 1-4 are parallelisable; Phase 5 depends on 3 and 4.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres + RLS), Twilio SMS, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-22-event-sms-cross-promotion-and-tone-refresh.md`

---

## Phase Dependency Graph

```
Phase 1 (Tone Refresh)          ──┐
Phase 2 (Review-Once)           ──┤── all independent, can run in parallel
Phase 3 (Booking Service)       ──┤
Phase 4 (Cross-Promotion)       ──┘
                                   │
Phase 5 (Reply-to-Book)         ←──┘ depends on Phases 3 + 4
```

---

## Phase 1: Tone Refresh

**Goal:** Update all hardcoded SMS message strings across the codebase to use the new cheeky/playful brand voice.

**Files:**
- Modify: `src/app/api/cron/event-guest-engagement/route.ts` — event reminders, review followups
- Modify: `src/app/api/event-bookings/route.ts` — event booking confirmations
- Modify: `src/app/api/foh/event-bookings/route.ts` — FOH event booking confirmations
- Modify: `src/lib/table-bookings/bookings.ts` — table deposit, cancellation, Sunday preorder request
- Modify: `src/services/private-bookings.ts` — all private booking lifecycle messages
- Modify: `src/app/api/cron/private-booking-monitor/route.ts` — private booking reminders, expiry, feedback
- Modify: `src/app/api/cron/sunday-preorder/route.ts` — Sunday preorder reminders, cancellation
- Modify: `src/lib/parking/notifications.ts` — all parking notifications
- Modify: `src/lib/events/waitlist-offers.ts` — waitlist offer SMS
- Modify: `src/app/g/[token]/waitlist-offer/confirm/route.ts` — waitlist acceptance confirmations

### Task 1.1: Event Booking Confirmations

**Files:**
- Modify: `src/app/api/event-bookings/route.ts`
- Modify: `src/app/api/foh/event-bookings/route.ts`

- [ ] **Step 1: Find existing confirmation messages in event-bookings route**

Search for the SMS message body strings in `src/app/api/event-bookings/route.ts`. Look for `sendSMS` or `sendSmsSafe` calls and the message body construction near them. Note the exact strings and line numbers.

- [ ] **Step 2: Update confirmed booking message**

Replace the existing confirmed booking message body with:
```
The Anchor: {first_name}! You're in — {seats} seat(s) locked in for {event_name} on {event_date}. See you there! {manage_link}
```
Preserve all existing variable substitution logic — only change the template string, not the variables or send mechanics.

- [ ] **Step 3: Update pending payment message**

Replace the existing pending payment message body with:
```
The Anchor: {first_name}! {seats} seat(s) held for {event_name} — nice one! We'll ping you a payment link shortly. {manage_link}
```

- [ ] **Step 4: Update FOH event booking confirmations**

Apply the same message updates to `src/app/api/foh/event-bookings/route.ts`. The messages should be identical to the public route — same tone, same template strings.

- [ ] **Step 5: Run build to verify no syntax errors**

Run: `npm run build`
Expected: Build succeeds with no errors related to modified files.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/event-bookings/route.ts src/app/api/foh/event-bookings/route.ts
git commit -m "feat: refresh event booking confirmation SMS tone"
```

### Task 1.2: Event Reminders & Review Followups

**Files:**
- Modify: `src/app/api/cron/event-guest-engagement/route.ts`

- [ ] **Step 1: Find existing reminder and review messages**

Search for SMS message body strings in `src/app/api/cron/event-guest-engagement/route.ts`. Look for template_key `event_reminder_1d` and `event_review_followup` — find the exact message body construction.

- [ ] **Step 2: Update 1-day reminder message**

Replace with:
```
The Anchor: {first_name}! {event_name} is tomorrow at {event_time} — don't be late! {manage_link}
```

- [ ] **Step 3: Update post-event review message**

Replace with:
```
The Anchor: {first_name}! Hope you had a belter at {event_name} last night. Got 30 seconds? A quick review means the world to us: {review_link}
```

- [ ] **Step 4: Update table review followup message**

Find the `table_review_followup` template and replace with:
```
The Anchor: {first_name}! Thanks for popping in. Got 30 seconds? A quick review means the world to us: {review_link}
```

- [ ] **Step 5: Run build**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/event-guest-engagement/route.ts
git commit -m "feat: refresh event reminder and review SMS tone"
```

### Task 1.3: Table Booking Messages

**Files:**
- Modify: `src/lib/table-bookings/bookings.ts`

- [ ] **Step 1: Find existing table booking messages**

Search `src/lib/table-bookings/bookings.ts` for `sendSMS`/`sendSmsSafe` calls. Find the deposit confirmation, cancellation (with refund variants), and Sunday preorder request messages.

- [ ] **Step 2: Update deposit confirmation**

Replace with:
```
The Anchor: {first_name}! Deposit sorted — your table for {party_size} on {booking_date} is locked in. See you then! {manage_link}
```

- [ ] **Step 3: Update cancellation messages (3 variants, same template key)**

Replace the inline copy for each refund state:

*With refund:*
```
The Anchor: {first_name}, your booking on {date} has been cancelled. Your £{amount} refund will land within 5-10 days. Hope to see you again soon!
```

*No refund (within 3 days):*
```
The Anchor: {first_name}, your booking on {date} has been cancelled. As it's within 3 days, the deposit can't be refunded. Hope to see you another time!
```

*No deposit:*
```
The Anchor: {first_name}, your booking on {date} has been cancelled. Hope to see you again soon!
```

Keep the existing `table_booking_cancelled` template key — do NOT split into separate keys.

- [ ] **Step 4: Update Sunday preorder request**

Replace with:
```
The Anchor: {first_name}! Time to pick what you're having for Sunday lunch — get your pre-order in here: {preorder_link}
```

- [ ] **Step 5: Run build**

Run: `npm run build`

- [ ] **Step 6: Commit**

```bash
git add src/lib/table-bookings/bookings.ts
git commit -m "feat: refresh table booking SMS tone"
```

### Task 1.4: Sunday Preorder Messages

**Files:**
- Modify: `src/app/api/cron/sunday-preorder/route.ts`

- [ ] **Step 1: Find existing preorder messages**

Search for template keys `sunday_preorder_reminder_48h`, `sunday_preorder_reminder_26h`, `sunday_preorder_cancelled_24h`.

- [ ] **Step 2: Update 48-hour reminder**

Replace with:
```
The Anchor: {first_name}! Your Sunday lunch is coming up — get your pre-order in so we can have everything ready for you: {preorder_link}
```

- [ ] **Step 3: Update 26-hour final reminder**

Replace with:
```
The Anchor: {first_name}! Last chance to get your Sunday lunch pre-order in — we need it by tonight or we'll have to release your table: {preorder_link}
```

- [ ] **Step 4: Update 24-hour auto-cancellation**

Replace with:
```
The Anchor: {first_name}, we've had to release your Sunday lunch booking as the pre-order wasn't completed in time. No charge applied — hope to see you another week!
```

- [ ] **Step 5: Run build and commit**

```bash
npm run build
git add src/app/api/cron/sunday-preorder/route.ts
git commit -m "feat: refresh Sunday preorder SMS tone"
```

### Task 1.5: Private Booking Messages

**Files:**
- Modify: `src/services/private-bookings.ts`
- Modify: `src/app/api/cron/private-booking-monitor/route.ts`

- [ ] **Step 1: Audit all private booking SMS in private-bookings.ts**

Search `src/services/private-bookings.ts` for all `sendSMS`/`sendSmsSafe` calls. Map each to its template key. The complete list is:
- `private_booking_created`
- `private_booking_deposit_received`
- `private_booking_confirmed`
- `private_booking_date_changed`
- `private_booking_hold_extended`
- `private_booking_cancelled`
- `private_booking_thank_you`
- `private_booking_final_payment`

- [ ] **Step 2: Update each message in private-bookings.ts**

Replace each message body with the corresponding text from the spec (Section 4.4). Preserve all existing variable substitution and send mechanics. Only change the template strings.

- [ ] **Step 3: Audit private-booking-monitor cron messages**

Search `src/app/api/cron/private-booking-monitor/route.ts` for template keys:
- `private_booking_deposit_reminder_7day`
- `private_booking_deposit_reminder_1day`
- `private_booking_balance_reminder_14day`
- `private_booking_event_reminder_1d`
- `private_booking_expired`
- `private_booking_setup_reminder`
- `private_booking_post_event_followup`

- [ ] **Step 4: Update each message in private-booking-monitor cron**

Replace each message body with the corresponding text from the spec. Pay special attention to `private_booking_post_event_followup` — this is the Google review message:
```
The Anchor: {first_name}! Hope your event was everything you wanted. Got 30 seconds? A quick review means the world to us: {review_link}
```

- [ ] **Step 5: Run build and commit**

```bash
npm run build
git add src/services/private-bookings.ts src/app/api/cron/private-booking-monitor/route.ts
git commit -m "feat: refresh private booking SMS tone"
```

### Task 1.6: Parking Messages

**Files:**
- Modify: `src/lib/parking/notifications.ts`

- [ ] **Step 1: Find existing parking messages**

Search `src/lib/parking/notifications.ts` for all SMS message construction. The live template keys are:
- `parking_payment_reminder_week_before_expiry`
- `parking_payment_reminder_day_before_expiry`
- Plus session start/end notifications

- [ ] **Step 2: Update all four parking messages**

Replace with the spec's text (Section 4.5). Preserve template keys exactly as-is.

- [ ] **Step 3: Run build and commit**

```bash
npm run build
git add src/lib/parking/notifications.ts
git commit -m "feat: refresh parking SMS tone"
```

### Task 1.7: Waitlist Messages

**Files:**
- Modify: `src/lib/events/waitlist-offers.ts`
- Modify: `src/app/g/[token]/waitlist-offer/confirm/route.ts`

- [ ] **Step 1: Find existing waitlist messages**

Search for template keys `event_waitlist_offer`, `event_waitlist_accepted_confirmed`, `event_waitlist_accepted_pending_payment`.

- [ ] **Step 2: Update waitlist offer message**

Replace with:
```
The Anchor: {first_name}! A spot just opened up for {event_name} on {event_date}. Want it? Grab your seat here before it's gone: {offer_link}
```

- [ ] **Step 3: Update waitlist acceptance confirmations**

In `src/app/g/[token]/waitlist-offer/confirm/route.ts`, update both variants:

*Confirmed:*
```
The Anchor: {first_name}! You're in — {seats} seat(s) confirmed for {event_name} on {event_date}. See you there! {manage_link}
```

*Pending payment:*
```
The Anchor: {first_name}! {seats} seat(s) held for {event_name} — nice one! Complete your payment here: {payment_link}. {manage_link}
```

- [ ] **Step 4: Run full verification pipeline and commit**

```bash
npm run lint
npx tsc --noEmit
npm run build
git add src/lib/events/waitlist-offers.ts src/app/g/[token]/waitlist-offer/confirm/route.ts
git commit -m "feat: refresh waitlist SMS tone"
```

### Task 1.8: Final Phase 1 Verification

- [ ] **Step 1: Run full verification pipeline**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

- [ ] **Step 2: Grep for old tone patterns**

Search the codebase for remaining instances of the old "Hi {first_name}," pattern in SMS messages to ensure no messages were missed:

```bash
grep -rn "Hi \${" src/ --include="*.ts" | grep -i "anchor\|sms\|message\|reminder"
```

- [ ] **Step 3: Verify template keys unchanged**

Search for all template_key values in modified files and confirm they match the existing keys — no accidental renames.

---

## Phase 2: Review-Once Rule

**Goal:** Stop sending review request SMS to customers who have already clicked a review link. Add suppression persistence so skipped bookings don't get re-evaluated every cron run. Retire the private_booking_feedback_followup flow. Add private-booking review click tracking.

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_review_once_columns.sql`
- Modify: `src/app/api/cron/event-guest-engagement/route.ts` — add review-once check + suppression
- Modify: `src/app/api/cron/private-booking-monitor/route.ts` — add review-once check + retire feedback flow
- Modify: `src/app/r/[token]/route.ts` — extend to handle private booking review clicks
- Modify: `src/lib/private-bookings/feedback.ts` — disable new token generation

### Task 2.1: Database Migration

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_review_once_columns.sql`

- [ ] **Step 1: Create migration file**

```bash
npx supabase migration new review_once_columns
```

- [ ] **Step 2: Write migration SQL**

```sql
-- Review suppression tracking
ALTER TABLE bookings ADD COLUMN review_suppressed_at TIMESTAMPTZ;
ALTER TABLE table_bookings ADD COLUMN review_suppressed_at TIMESTAMPTZ;

-- Private booking review lifecycle
ALTER TABLE private_bookings ADD COLUMN review_processed_at TIMESTAMPTZ;
ALTER TABLE private_bookings ADD COLUMN review_clicked_at TIMESTAMPTZ;
```

- [ ] **Step 3: Dry-run migration**

Run: `npx supabase db push --dry-run`
Expected: Migration applies cleanly, no errors.

- [ ] **Step 4: Apply migration**

Run: `npx supabase db push`

- [ ] **Step 5: Audit existing queries**

Before modifying cron code, search for all queries that filter on review-related columns:

```bash
grep -rn "review_sms_sent_at\|review_clicked_at\|review_window" src/ --include="*.ts" -l
```

Document all files that will need `AND review_suppressed_at IS NULL` added to their queries.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*review_once*
git commit -m "feat: add review suppression and click tracking columns"
```

### Task 2.2: Review-Once Check Function

**Files:**
- Create: `src/lib/sms/review-once.ts`

- [ ] **Step 1: Create the review-once check utility**

```typescript
import { getDb } from '@/lib/supabase/admin';

/**
 * Check if a customer has ever clicked a review link across any booking type.
 * Used to prevent sending duplicate review requests.
 */
export async function hasCustomerReviewed(customerIds: string[]): Promise<Set<string>> {
  if (customerIds.length === 0) return new Set();

  const db = await getDb();
  const reviewed = new Set<string>();

  // Batch check across all three tables
  const [bookings, tableBookings, privateBookings] = await Promise.all([
    db.from('bookings')
      .select('customer_id')
      .in('customer_id', customerIds)
      .not('review_clicked_at', 'is', null),
    db.from('table_bookings')
      .select('customer_id')
      .in('customer_id', customerIds)
      .not('review_clicked_at', 'is', null),
    db.from('private_bookings')
      .select('customer_id')
      .in('customer_id', customerIds)
      .not('review_clicked_at', 'is', null),
  ]);

  for (const row of bookings.data ?? []) reviewed.add(row.customer_id);
  for (const row of tableBookings.data ?? []) reviewed.add(row.customer_id);
  for (const row of privateBookings.data ?? []) reviewed.add(row.customer_id);

  return reviewed;
}
```

- [ ] **Step 2: Write test for the utility**

Create `src/lib/sms/__tests__/review-once.test.ts` with tests for:
- Empty input returns empty set
- Customer with event review_clicked_at is in the set
- Customer with table review_clicked_at is in the set
- Customer with private review_clicked_at is in the set
- Customer with no clicks is not in the set
- Cross-channel: click in one table suppresses across all

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/lib/sms/__tests__/review-once.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/lib/sms/review-once.ts src/lib/sms/__tests__/review-once.test.ts
git commit -m "feat: add review-once check utility with batch lookup"
```

### Task 2.3: Integrate Review-Once into Event Guest Engagement Cron

**Files:**
- Modify: `src/app/api/cron/event-guest-engagement/route.ts`

- [ ] **Step 1: Add review-once check before event review sends**

In the event review followup section:
1. Collect all `customer_id` values from eligible bookings
2. Call `hasCustomerReviewed(customerIds)` to get the reviewed Set
3. For each eligible booking, if customer is in the reviewed Set:
   - Set `review_suppressed_at = NOW()` on the booking
   - Skip the SMS send
   - Log as suppressed (not as a send failure)

- [ ] **Step 2: Add review_suppressed_at to eligible-for-review query**

Find the query that selects bookings eligible for review. Add `AND review_suppressed_at IS NULL` to the WHERE clause alongside the existing `review_sms_sent_at IS NULL` check.

- [ ] **Step 3: Apply same logic to table review followups**

Repeat steps 1-2 for the table review followup section in the same cron.

- [ ] **Step 4: Run build and tests**

```bash
npm run build
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/event-guest-engagement/route.ts
git commit -m "feat: integrate review-once rule into event engagement cron"
```

### Task 2.4: Integrate Review-Once into Private Booking Monitor + Retire Feedback Flow

**Files:**
- Modify: `src/app/api/cron/private-booking-monitor/route.ts`
- Modify: `src/lib/private-bookings/feedback.ts`

- [ ] **Step 1: Add review-once check to private booking followup section**

In the `private_booking_post_event_followup` section:
1. Collect customer_ids, call `hasCustomerReviewed()`
2. If reviewed: set `review_processed_at = NOW()`, skip send
3. If sent: also set `review_processed_at = NOW()`
4. Update the eligibility query to check `review_processed_at IS NULL`

- [ ] **Step 2: Disable the private_booking_feedback_followup flow**

In the same cron file, find the `private_booking_feedback_followup` section and either:
- Comment it out with a `// RETIRED: consolidated into private_booking_post_event_followup` note
- Or wrap in an `if (false)` block

Do NOT delete it yet — keep the code for reference during the transition.

- [ ] **Step 3: Disable new feedback token generation**

In `src/lib/private-bookings/feedback.ts`, add an early return to the token generation function with a comment:
```typescript
// RETIRED: private booking feedback consolidated to Google review only
// Existing tokens continue to work, but no new ones are generated.
return null;
```

- [ ] **Step 4: Run build and commit**

```bash
npm run build
git add src/app/api/cron/private-booking-monitor/route.ts src/lib/private-bookings/feedback.ts
git commit -m "feat: integrate review-once into private booking cron, retire feedback flow"
```

### Task 2.5: Extend Review Redirect for Private Bookings

**Files:**
- Modify: `src/app/r/[token]/route.ts`

- [ ] **Step 1: Read the existing review redirect route**

Understand how it currently sets `review_clicked_at` on `bookings` and `table_bookings`. Note the token lookup pattern and redirect logic.

- [ ] **Step 2: Add private booking support**

Extend the token lookup to also check for private booking review tokens. When a private booking token is matched:
1. Set `private_bookings.review_clicked_at = NOW()` for the matching booking
2. Redirect to the Google review URL (same as event/table redirects)

- [ ] **Step 3: Ensure private booking post-event SMS uses this redirect route**

Verify that the `private_booking_post_event_followup` SMS in the cron uses the `/r/[token]` redirect pattern (not a direct Google review URL). If it currently uses a direct URL, update it to go through the redirect so clicks are tracked.

- [ ] **Step 4: Run build, tests, and commit**

```bash
npm run build
npm test
git add src/app/r/[token]/route.ts
git commit -m "feat: extend review redirect to track private booking review clicks"
```

### Task 2.6: Phase 2 Verification

- [ ] **Step 1: Full verification pipeline**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

- [ ] **Step 2: Manual verification checklist**

- Verify `review_suppressed_at` column exists on bookings and table_bookings
- Verify `review_processed_at` and `review_clicked_at` columns exist on private_bookings
- Verify the feedback token generation returns null
- Verify the event engagement cron's review query includes `AND review_suppressed_at IS NULL`

---

## Phase 3: Booking Service Extraction

**Goal:** Extract event booking creation into a shared `EventBookingService` class that can be called from the public API, FOH API, and (later) the Twilio webhook.

**Files:**
- Create: `src/services/event-bookings.ts`
- Create: `src/services/__tests__/event-bookings.test.ts`
- Modify: `src/app/api/event-bookings/route.ts` — delegate to service
- Modify: `src/app/api/foh/event-bookings/route.ts` — delegate to service

### Task 3.1: Extract EventBookingService

**Files:**
- Create: `src/services/event-bookings.ts`

- [ ] **Step 1: Read existing booking creation code**

Read the POST handler in `src/app/api/event-bookings/route.ts` and `src/app/api/foh/event-bookings/route.ts`. Identify:
- The RPC call to `create_event_booking_v05` and its parameters
- The validation logic before the RPC call
- The post-booking SMS sending logic
- The source values used (`'brand_site'`, `'admin'`, `'walk-in'`)

- [ ] **Step 2: Create the service class**

Create `src/services/event-bookings.ts` with:

```typescript
export class EventBookingService {
  static async createBooking(params: {
    eventId: string;
    customerId: string;
    seats: number;
    source: 'brand_site' | 'admin' | 'walk-in' | 'sms_reply';
    // ... other params from existing RPC call
  }): Promise<{ success: boolean; bookingId?: string; error?: string }> {
    // Extract the shared logic from the route handlers
    // Call create_event_booking_v05 RPC
    // Handle SMS confirmation sending
    // Return result
  }
}
```

Follow the class-based pattern used by all other services in `src/services/`.

- [ ] **Step 3: Write tests**

Create `src/services/__tests__/event-bookings.test.ts`:
- Test that createBooking calls the RPC with correct parameters
- Test each source value is passed through correctly
- Test validation error handling
- Test that confirmation SMS is triggered on success
- Mock Supabase client and Twilio

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/services/__tests__/event-bookings.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/services/event-bookings.ts src/services/__tests__/event-bookings.test.ts
git commit -m "feat: extract EventBookingService with shared createBooking method"
```

### Task 3.2: Migrate Public API Route

**Files:**
- Modify: `src/app/api/event-bookings/route.ts`

- [ ] **Step 1: Replace inline booking creation with service call**

In the POST handler, replace the inline RPC call and surrounding logic with:
```typescript
const result = await EventBookingService.createBooking({
  eventId,
  customerId,
  seats,
  source: 'brand_site',
  // ... other params
});
```

Keep the request parsing and auth checks in the route — only the booking creation logic moves to the service.

- [ ] **Step 2: Run build and tests**

```bash
npm run build
npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/event-bookings/route.ts
git commit -m "refactor: delegate public event booking to EventBookingService"
```

### Task 3.3: Migrate FOH API Route

**Files:**
- Modify: `src/app/api/foh/event-bookings/route.ts`

- [ ] **Step 1: Replace inline booking creation with service call**

Same pattern as 3.2, but using the FOH's source values (`'admin'` or `'walk-in'` as determined by existing logic in the route).

- [ ] **Step 2: Run build and tests**

```bash
npm run build
npm test
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/foh/event-bookings/route.ts
git commit -m "refactor: delegate FOH event booking to EventBookingService"
```

### Task 3.4: Phase 3 Verification

- [ ] **Step 1: Full verification pipeline**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

- [ ] **Step 2: Verify both routes still work**

The public and FOH routes should produce identical behaviour to before the refactor. Any manual or integration tests for event bookings should pass unchanged.

---

## Phase 4: Cross-Promotion Engine

**Goal:** Add a cron stage that sends promotional SMS to past event attendees 14 days before similar upcoming events. Create the `sms_promo_context` table, audience selection RPC, `sms_promo` marketing channel, and integrate into the existing event-guest-engagement cron.

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_cross_promo_infrastructure.sql`
- Create: `src/lib/sms/cross-promo.ts`
- Create: `src/lib/sms/__tests__/cross-promo.test.ts`
- Modify: `src/lib/event-marketing-links.ts` — add `sms_promo` channel
- Modify: `src/app/api/cron/event-guest-engagement/route.ts` — add promo stage

### Task 4.1: Database Migration

**Files:**
- Create: `supabase/migrations/YYYYMMDDHHMMSS_cross_promo_infrastructure.sql`

- [ ] **Step 1: Create migration**

```bash
npx supabase migration new cross_promo_infrastructure
```

- [ ] **Step 2: Write migration SQL**

```sql
-- sms_promo_context table
CREATE TABLE sms_promo_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  phone_number TEXT NOT NULL,
  event_id UUID NOT NULL REFERENCES events(id),
  template_key TEXT NOT NULL,
  message_id UUID REFERENCES messages(id),
  reply_window_expires_at TIMESTAMPTZ NOT NULL,
  booking_created BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sms_promo_context_reply_lookup
ON sms_promo_context (phone_number, reply_window_expires_at DESC)
WHERE booking_created = FALSE;

CREATE INDEX idx_sms_promo_context_frequency
ON sms_promo_context (customer_id, created_at DESC);

ALTER TABLE sms_promo_context ENABLE ROW LEVEL SECURITY;

-- Composite index for audience selection
CREATE INDEX idx_ccs_category_last_attended
ON customer_category_stats (category_id, last_attended_date DESC);

-- Audience selection RPC
CREATE OR REPLACE FUNCTION get_cross_promo_audience(
  p_event_id UUID,
  p_category_id UUID,
  p_recency_months INT DEFAULT 6,
  p_frequency_cap_days INT DEFAULT 7,
  p_max_recipients INT DEFAULT 100
)
RETURNS TABLE (
  customer_id UUID,
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT,
  last_event_category TEXT,
  times_attended BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id AS customer_id,
    c.first_name,
    c.last_name,
    c.mobile_e164 AS phone_number,
    ec.name AS last_event_category,
    ccs.times_attended
  FROM customer_category_stats ccs
  JOIN customers c ON c.id = ccs.customer_id
  JOIN event_categories ec ON ec.id = ccs.category_id
  WHERE ccs.category_id = p_category_id
    AND ccs.last_attended_date >= (CURRENT_DATE - (p_recency_months || ' months')::INTERVAL)
    AND c.marketing_sms_opt_in = TRUE
    AND c.sms_opt_in = TRUE
    AND (c.sms_status IS NULL OR c.sms_status = 'active')
    AND c.mobile_e164 IS NOT NULL
    -- Exclude customers already booked for this event
    AND NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.customer_id = c.id
        AND b.event_id = p_event_id
        AND b.status IN ('pending_payment', 'confirmed')
        AND b.is_reminder_only = FALSE
    )
    -- Exclude customers who received a promo in the last N days
    AND NOT EXISTS (
      SELECT 1 FROM sms_promo_context spc
      WHERE spc.customer_id = c.id
        AND spc.created_at > (NOW() - (p_frequency_cap_days || ' days')::INTERVAL)
    )
  ORDER BY ccs.last_attended_date DESC
  LIMIT p_max_recipients;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 3: Dry-run and apply migration**

```bash
npx supabase db push --dry-run
npx supabase db push
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/*cross_promo*
git commit -m "feat: add cross-promo infrastructure (table, RPC, indexes)"
```

### Task 4.2: Add sms_promo Marketing Channel

**Files:**
- Modify: `src/lib/event-marketing-links.ts`

- [ ] **Step 1: Read existing channel definitions**

Read `src/lib/event-marketing-links.ts` and find `EventMarketingChannelKey` type, `EVENT_MARKETING_CHANNELS` array, and `EVENT_MARKETING_CHANNEL_MAP`.

- [ ] **Step 2: Add sms_promo channel**

Add `'sms_promo'` to the `EventMarketingChannelKey` type union, add an entry to `EVENT_MARKETING_CHANNELS`, and add to `EVENT_MARKETING_CHANNEL_MAP` with label "SMS Promo", type "digital", and appropriate description.

- [ ] **Step 3: Run build and commit**

```bash
npm run build
git add src/lib/event-marketing-links.ts
git commit -m "feat: add sms_promo marketing channel for cross-promotion links"
```

### Task 4.3: Cross-Promotion Send Logic

**Files:**
- Create: `src/lib/sms/cross-promo.ts`
- Create: `src/lib/sms/__tests__/cross-promo.test.ts`

- [ ] **Step 1: Create the cross-promo module**

Create `src/lib/sms/cross-promo.ts` with:

```typescript
import { getDb } from '@/lib/supabase/admin';
import { sendSmsSafe } from '@/lib/twilio';
import { EventMarketingService } from '@/services/event-marketing';
import { formatDateInLondon } from '@/lib/dateUtils';
import { parsePositiveIntEnv } from '@/lib/sms/safety';

const EVENT_PROMO_REPLY_WINDOW_HOURS = parsePositiveIntEnv('EVENT_PROMO_REPLY_WINDOW_HOURS', 48);
const EVENT_PROMO_MIN_CAPACITY = parsePositiveIntEnv('EVENT_PROMO_MIN_CAPACITY', 10);

export async function sendCrossPromoForEvent(event: {
  id: string;
  name: string;
  date: string;
  payment_mode: string;
  category_id: string;
}): Promise<{ sent: number; skipped: number; errors: number }> {
  // 1. Check capacity via get_event_capacity_snapshot_v05
  // 2. Skip if seats_remaining < MIN_CAPACITY for free/cash events
  // 3. Skip if seats_remaining === 0 for all events
  // 4. Call get_cross_promo_audience RPC
  // 5. For paid events: generate short-link once via EventMarketingService.generateSingleLink()
  // 6. For each customer: build message, send via sendSmsSafe, insert sms_promo_context row
  // 7. Return counts
}
```

- [ ] **Step 2: Write tests**

Test:
- Free event with sufficient capacity → sends reply-to-book template
- Paid event → sends link template
- Event with < 10 seats remaining (free) → skips
- Sold out event → skips
- Idempotency: same customer+event → only sends once
- Frequency cap: customer received promo within 7 days → skipped by RPC

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/lib/sms/__tests__/cross-promo.test.ts
git add src/lib/sms/cross-promo.ts src/lib/sms/__tests__/cross-promo.test.ts
git commit -m "feat: add cross-promotion SMS send logic"
```

### Task 4.4: Integrate into Event Guest Engagement Cron

**Files:**
- Modify: `src/app/api/cron/event-guest-engagement/route.ts`

- [ ] **Step 1: Add promo stage constants**

Add at the top of the file:
```typescript
const EVENT_PROMO_LOOKAHEAD_DAYS = parsePositiveIntEnv('EVENT_PROMO_LOOKAHEAD_DAYS', 14);
const MAX_EVENT_PROMOS_PER_RUN = parsePositiveIntEnv('MAX_EVENT_PROMOS_PER_RUN', 100);
const EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT = parsePositiveIntEnv('EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT', 120);
const EVENT_PROMO_TEMPLATE_KEYS = ['event_cross_promo_14d', 'event_cross_promo_14d_paid'];
```

- [ ] **Step 2: Add promo stage AFTER reminders and reviews**

After the existing review stages, add:
1. Elapsed time check (skip if >240 seconds)
2. Global SMS budget check (skip if <30 slots remaining)
3. Promo-specific send guard check
4. Query upcoming events within `EVENT_PROMO_LOOKAHEAD_DAYS` where `booking_open = true`
5. For each event, call `sendCrossPromoForEvent()`, tracking total sends against `MAX_EVENT_PROMOS_PER_RUN`
6. Break if per-run cap reached

- [ ] **Step 3: Add cleanup step for old sms_promo_context rows**

At the end of the cron (after all stages):
```typescript
// Cleanup old promo context rows (>30 days)
await db.from('sms_promo_context')
  .delete()
  .lt('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
```

- [ ] **Step 4: Run build and tests**

```bash
npm run build
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/event-guest-engagement/route.ts
git commit -m "feat: add cross-promotion stage to event engagement cron"
```

### Task 4.5: Phase 4 Verification

- [ ] **Step 1: Full verification pipeline**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

- [ ] **Step 2: Manual verification**

- Verify `sms_promo_context` table exists with RLS enabled
- Verify `get_cross_promo_audience` RPC can be called
- Verify `sms_promo` channel appears in marketing channel list
- Verify composite index exists on `customer_category_stats`

---

## Phase 5: Reply-to-Book

**Goal:** Enable customers to reply to cross-promotion SMS with a number to automatically book seats for free/cash-on-door events.

**Depends on:** Phase 3 (EventBookingService) + Phase 4 (sms_promo_context table, cross-promo sending)

**Files:**
- Create: `src/lib/sms/reply-to-book.ts`
- Create: `src/lib/sms/__tests__/reply-to-book.test.ts`
- Modify: `src/app/api/webhooks/twilio/route.ts` — add reply-to-book code path

### Task 5.1: Seat Count Parser

**Files:**
- Create: `src/lib/sms/reply-to-book.ts`
- Create: `src/lib/sms/__tests__/reply-to-book.test.ts`

- [ ] **Step 1: Write failing tests for seat parser**

```typescript
// src/lib/sms/__tests__/reply-to-book.test.ts
import { parseSeatCount } from '../reply-to-book';

describe('parseSeatCount', () => {
  it('parses plain number', () => expect(parseSeatCount('4')).toBe(4));
  it('parses number with text', () => expect(parseSeatCount('4 please')).toBe(4));
  it('parses padded number', () => expect(parseSeatCount(' 4 ')).toBe(4));
  it('parses number after text', () => expect(parseSeatCount('yes 2')).toBe(2));
  it('takes first number', () => expect(parseSeatCount('book me 6 seats')).toBe(6));
  it('returns null for zero', () => expect(parseSeatCount('0')).toBeNull());
  it('returns null for no number', () => expect(parseSeatCount('hello')).toBeNull());
  it('returns null for empty', () => expect(parseSeatCount('')).toBeNull());
  it('returns null for negative', () => expect(parseSeatCount('-3')).toBeNull());
  it('caps at 10', () => expect(parseSeatCount('15')).toBe(15)); // >10 handled by caller
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/sms/__tests__/reply-to-book.test.ts`
Expected: FAIL — `parseSeatCount` not defined.

- [ ] **Step 3: Implement parseSeatCount**

```typescript
// src/lib/sms/reply-to-book.ts
export function parseSeatCount(body: string): number | null {
  const match = body.match(/(\d+)/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  if (num <= 0 || isNaN(num)) return null;
  return num;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/sms/__tests__/reply-to-book.test.ts`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sms/reply-to-book.ts src/lib/sms/__tests__/reply-to-book.test.ts
git commit -m "feat: add seat count parser for reply-to-book"
```

### Task 5.2: Promo Context Lookup

**Files:**
- Modify: `src/lib/sms/reply-to-book.ts`
- Modify: `src/lib/sms/__tests__/reply-to-book.test.ts`

- [ ] **Step 1: Write failing tests for promo lookup**

Test `findActivePromoContext(phoneNumber)`:
- Returns promo context when matching promo exists and reply window not expired
- Returns null when no promo exists for phone
- Returns null when reply window expired
- Returns null when booking_created = true

- [ ] **Step 2: Implement findActivePromoContext**

```typescript
export async function findActivePromoContext(phoneNumber: string) {
  const db = await getDb();
  const { data } = await db
    .from('sms_promo_context')
    .select('id, customer_id, event_id, template_key')
    .eq('phone_number', phoneNumber)
    .eq('booking_created', false)
    .gt('reply_window_expires_at', new Date().toISOString())
    .order('reply_window_expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}
```

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/lib/sms/__tests__/reply-to-book.test.ts
git add src/lib/sms/reply-to-book.ts src/lib/sms/__tests__/reply-to-book.test.ts
git commit -m "feat: add promo context lookup for reply-to-book"
```

### Task 5.3: Reply-to-Book Handler

**Files:**
- Modify: `src/lib/sms/reply-to-book.ts`

- [ ] **Step 1: Write the main handler**

```typescript
export async function handleReplyToBook(
  phoneNumber: string,
  messageBody: string
): Promise<{ handled: boolean; response?: string }> {
  // 1. Parse seat count
  const seats = parseSeatCount(messageBody);
  if (seats === null) return { handled: false };

  // 2. Find active promo context
  const promo = await findActivePromoContext(phoneNumber);
  if (!promo) return { handled: false };

  // 3. Check seat limit
  const maxSeats = parsePositiveIntEnv('EVENT_PROMO_MAX_SEATS', 10);
  if (seats > maxSeats) {
    return { handled: true, response: `That's a big group! Give us a ring on ${venuePhone} and we'll sort you out.` };
  }

  // 4. Check capacity
  // 5. Check for existing booking
  // 6. Create booking via EventBookingService.createBooking({ source: 'sms_reply' })
  // 7. Handle unique constraint (concurrency) → "already booked" response
  // 8. Mark promo context as booking_created = true
  // 9. Return { handled: true } (confirmation SMS sent by booking service)
}
```

- [ ] **Step 2: Write tests for each edge case**

Test all scenarios from the spec's edge case table:
- Seats > 10 → venue phone response
- Event sold out → "Gutted" response
- Not enough seats → "We've only got X" response
- Already booked → "already booked in" response
- Concurrency (unique constraint) → "already booked in" response
- Success → handled: true, no response (confirmation sent by service)

- [ ] **Step 3: Run tests and commit**

```bash
npx vitest run src/lib/sms/__tests__/reply-to-book.test.ts
git add src/lib/sms/reply-to-book.ts src/lib/sms/__tests__/reply-to-book.test.ts
git commit -m "feat: add reply-to-book handler with edge cases"
```

### Task 5.4: Integrate into Twilio Webhook

**Files:**
- Modify: `src/app/api/webhooks/twilio/route.ts`

- [ ] **Step 1: Read existing inbound SMS handling**

Understand the current flow: signature validation → status callback handling → inbound message handling. Identify where to insert the reply-to-book check.

- [ ] **Step 2: Add reply-to-book check before existing inbound handling**

In the inbound message section, BEFORE the existing message thread handling:

```typescript
import { handleReplyToBook } from '@/lib/sms/reply-to-book';

// Try reply-to-book first
const replyResult = await handleReplyToBook(fromNumber, body);
if (replyResult.handled) {
  if (replyResult.response) {
    // Send edge-case response (bypass quiet hours for active replies)
    await sendSmsSafe({
      to: fromNumber,
      body: replyResult.response,
      templateKey: 'event_reply_booking_response',
      bypassQuietHours: true,
      // ... other params
    });
  }
  return NextResponse.json({ success: true });
}

// Fall through to existing inbound handling...
```

- [ ] **Step 3: Run build and tests**

```bash
npm run build
npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/twilio/route.ts
git commit -m "feat: integrate reply-to-book into Twilio webhook"
```

### Task 5.5: Phase 5 Verification

- [ ] **Step 1: Full verification pipeline**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

- [ ] **Step 2: End-to-end manual test plan**

1. Send a cross-promotion SMS to a test phone number (use the cron or a manual trigger)
2. Reply with "4" from that phone
3. Verify a booking appears in the admin for 4 seats with source `sms_reply`
4. Verify the booking confirmation SMS is sent automatically
5. Reply again with "2" — verify "already booked" response
6. Send a promo for a sold-out event — reply with "2" — verify "fully booked" response
7. Wait 48+ hours and reply — verify no response (falls through to staff messages)

---

## Final Verification

After all 5 phases are complete:

- [ ] **Full verification pipeline**

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

- [ ] **Cross-phase integration check**

- Verify the tone-refreshed messages are used in the cross-promotion templates (consistent voice)
- Verify the review-once rule applies to the post-event review SMS (which was also tone-refreshed)
- Verify the booking service extraction works end-to-end through the reply-to-book flow
- Verify the cross-promotion → reply-to-book → booking confirmation flow works end-to-end

- [ ] **Update .env.example with new variables**

Add all new `EVENT_PROMO_*` and `MAX_EVENT_PROMOS_PER_RUN` variables with their defaults.
