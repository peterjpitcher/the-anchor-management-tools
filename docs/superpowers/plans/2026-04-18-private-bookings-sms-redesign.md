# Private Bookings SMS Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the private bookings SMS pipeline — manager-gated review requests, refund-aware cancellation copy, tone refresh across every template, consolidated cron path, per-booking communications tab, and a DB-enforced deletion gate — while retiring two legacy cron routes.

**Architecture:** Three layers. (1) A pure-function message module (`src/lib/private-bookings/messages.ts`) builds every SMS body from raw booking fields; no DB, no flags, no eligibility. (2) Service helpers own state: financial-outcome computation for cancellations, scheduled-SMS eligibility shared by cron + UI, and post-event outcome claim logic. (3) DB migrations add the minimal schema needed (4 columns, 1 enum extension, 1 idempotency table, 1 delete-gate trigger). Two legacy cron routes (`post-event-followup`, `booking-balance-reminders`) are deleted and their behaviour folded into `private-booking-monitor`. The post-event manager gate uses the existing `guest_tokens` table and the existing `manager-notifications.ts` abstraction — no parallel infrastructure. All outcome links use GET-confirmation + POST-mutation to survive email scanner prefetch.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript (strict) · Tailwind v4 · Supabase (PostgreSQL + RLS) · Vitest · Microsoft Graph (email) · Twilio (SMS).

**Source spec:** [`docs/superpowers/specs/2026-04-18-private-bookings-sms-redesign-design.md`](../specs/2026-04-18-private-bookings-sms-redesign-design.md). Read alongside this plan — copy, voice principles, and reviewer findings live there.

**Adversarial review:** [`tasks/codex-qa-review/2026-04-18-private-bookings-sms-redesign-adversarial-review.md`](../../../tasks/codex-qa-review/2026-04-18-private-bookings-sms-redesign-adversarial-review.md) and [`tasks/codex-qa-review/2026-04-18-private-bookings-sms-redesign-claude-handoff.md`](../../../tasks/codex-qa-review/2026-04-18-private-bookings-sms-redesign-claude-handoff.md). Every blocker from those reviews is addressed in a specific task below.

---

## Confirmed decisions (approved 2026-04-18)

- **A1** — Assume `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` is `false` in production. Phase 4 is enablement pre-work, not a live-bug fix. Verify the actual Vercel env value as the first step of Phase 4 (Task 4.0 below) — if it's `true`, upgrade Phase 4 to P0 and ship it ahead of Phase 2.
- **A2** — Refund SLA is **10 working days**. Used verbatim in `bookingCancelledRefundableMessage`.
- **A3** — Outcome token lifetime is **14 days**.
- **A4** — Retire `/api/cron/post-event-followup` and `/api/cron/booking-balance-reminders`. Task 1.7 deletes them.
- **A5** — **Deposit is always non-refundable on cancellation.** `getPrivateBookingCancellationOutcome()` encodes this: deposit → `retained_amount`; balance payments → `refund_amount` (unless disputed).
- **A6** — No manager-inbox escalation in v1. Add a weekly ops query (Task 4.5) to flag bookings stuck at `post_event_outcome = 'pending'` for >14 days. If that list consistently exceeds 30% of eligible bookings, add escalation in a follow-up.

---

## File Structure

### New files

| Path | Responsibility |
|------|---------------|
| `src/lib/private-bookings/messages.ts` | Pure SMS body builders (20 functions). Uses `getSmartFirstName()` and `sanitiseSmsVariable()`. No DB, no flags. |
| `src/lib/private-bookings/tbd-detection.ts` | `isBookingDateTbd(booking)` — wraps `internal_notes` containing `DATE_TBD_NOTE` check. |
| `src/lib/sms/sanitise.ts` | `sanitiseSmsVariable(value, maxLen)` — strips control chars, collapses whitespace, caps length. |
| `src/services/private-bookings/financial.ts` | `getPrivateBookingPaidTotals()`, `getPrivateBookingCancellationOutcome()`, `CancellationFinancialOutcome` type. |
| `src/services/private-bookings/scheduled-sms.ts` | `getBookingScheduledSms(bookingId, now)` — shared eligibility for cron + UI. |
| `src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts` | GET confirmation page, POST mutation. |
| `src/components/private-bookings/CommunicationsTab.tsx` | Per-booking history + scheduled preview UI. |
| `src/components/private-bookings/CommunicationsTabServer.tsx` | Server component wrapper that fetches data. |
| `tests/lib/privateBookingsMessages.test.ts` | Snapshot + edge-case tests for all 20 template functions. |
| `tests/lib/privateBookingsTbdDetection.test.ts` | TBD helper tests. |
| `tests/lib/smsSanitise.test.ts` | Sanitiser tests. |
| `tests/services/privateBookingsFinancial.test.ts` | All four financial-outcome paths. |
| `tests/services/privateBookingsScheduledSms.test.ts` | Eligibility matrix + suppression reasons. |
| `tests/api/privateBookingOutcomeRoute.test.ts` | GET/POST behaviour + scanner prefetch + concurrency. |
| `tests/api/privateBookingMonitorPass5.test.ts` | Pass 5a email send + Pass 5b gated review SMS. |
| `tests/components/privateBookingsCommunicationsTab.test.tsx` | History + scheduled rendering + suppression labels. |

### Modified files

| Path | What changes |
|------|-------------|
| `src/services/private-bookings/mutations.ts` | `cancelBooking()` picks variant via financial outcome; `deletePrivateBooking()` checks SMS-sent guard; all inline SMS bodies call `messages.ts`. |
| `src/services/private-bookings/payments.ts` | All inline SMS bodies call `messages.ts`. |
| `src/app/api/cron/private-booking-monitor/route.ts` | Pass 3 extended (7/1-day balance reminders); Pass 5 split into 5a/5b; all bodies call `messages.ts`; TBD filter via helper; idempotency key check. |
| `src/lib/private-bookings/manager-notifications.ts` | Add `sendPrivateBookingOutcomeEmail()`. |
| `src/lib/sms/support.ts` | No change to `ensureReplyInstruction` (stays a no-op) — but document in comment. |
| `src/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx` | Template suggestion list updated to refreshed copy. |
| `src/app/(authenticated)/private-bookings/[id]/page.tsx` | Renders new `CommunicationsTab`. |
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` (or equivalent) | Delete button disable logic + confirmation modal with resolved-body preview. |
| `src/app/actions/privateBookingActions.ts` | Export server actions for outcome flow + delete gate + scheduled-SMS fetch. |
| `vercel.json` | Remove entries for `/api/cron/post-event-followup` and `/api/cron/booking-balance-reminders`. |
| `supabase/migrations/*` | New migrations (see Phase 1). |

### Deleted files

| Path | Reason |
|------|--------|
| `src/app/api/cron/post-event-followup/route.ts` | Superseded by `private-booking-monitor` Pass 5a/5b. |
| `src/app/api/cron/booking-balance-reminders/route.ts` | Folded into `private-booking-monitor` Pass 3. |

---

## Phase 1 — Infrastructure, helpers, legacy cron retirement

Purpose: land the foundation — DB schema, shared helpers, legacy cron removal. No customer-facing behaviour change yet. After Phase 1, the codebase is ready for the tone/copy/gate work in subsequent phases.

---

### Task 1.1 — DB migration: private_bookings columns + backfill

**Files:**
- Create: `supabase/migrations/20260418120000_pb_sms_review_lifecycle.sql`

- [ ] **Step 1: Verify migration timestamp is unique**

Run: `ls supabase/migrations/ | grep "20260418" || echo "ok"`
Expected: `ok`

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/20260418120000_pb_sms_review_lifecycle.sql
BEGIN;

ALTER TABLE private_bookings
  ADD COLUMN post_event_outcome text
    CHECK (post_event_outcome IN ('pending','went_well','issues','skip'))
    DEFAULT 'pending',
  ADD COLUMN post_event_outcome_decided_at timestamptz,
  ADD COLUMN outcome_email_sent_at timestamptz,
  ADD COLUMN review_sms_sent_at timestamptz;

-- Backfill: rows where review was already processed before this migration
-- Set their outcome to 'skip' so the new gate won't re-trigger.
UPDATE private_bookings
SET post_event_outcome = 'skip',
    post_event_outcome_decided_at = review_processed_at
WHERE review_processed_at IS NOT NULL;

COMMENT ON COLUMN private_bookings.post_event_outcome IS
  'Manager decision on whether to send review request: pending (not yet decided), went_well (send), issues (do not send), skip (do not send).';
COMMENT ON COLUMN private_bookings.post_event_outcome_decided_at IS
  'Timestamp when post_event_outcome was moved off pending.';
COMMENT ON COLUMN private_bookings.outcome_email_sent_at IS
  'Timestamp when the manager outcome email was successfully dispatched.';
COMMENT ON COLUMN private_bookings.review_sms_sent_at IS
  'Timestamp when the review request SMS was sent to the customer.';

COMMIT;
```

- [ ] **Step 3: Dry-run the migration**

Run: `npx supabase db push --dry-run`
Expected: output shows the new migration will be applied, no destructive operations flagged.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260418120000_pb_sms_review_lifecycle.sql
git commit -m "feat(db): add post_event_outcome lifecycle columns to private_bookings

Adds post_event_outcome (enum), post_event_outcome_decided_at,
outcome_email_sent_at, review_sms_sent_at columns. Backfills 'skip' for
rows where review_processed_at is already set so the new gate does not
re-trigger existing reviews."
```

---

### Task 1.2 — DB migration: extend guest_tokens action enum

**Files:**
- Create: `supabase/migrations/20260418120100_pb_outcome_token_action.sql`

- [ ] **Step 1: Find the current action check constraint**

Run: `grep -n "guest_tokens_action_check\|action text" supabase/migrations/*.sql | head -20`
Expected: locate the migration that defines the action CHECK constraint; note the existing values.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/20260418120100_pb_outcome_token_action.sql
BEGIN;

-- Replace existing check constraint with one that includes the new action.
-- NOTE: if existing check constraint name differs, adjust the DROP.
ALTER TABLE guest_tokens DROP CONSTRAINT IF EXISTS guest_tokens_action_check;

ALTER TABLE guest_tokens
  ADD CONSTRAINT guest_tokens_action_check
  CHECK (action IN (
    'event_management',
    'booking_management',
    'review_click',
    'private_feedback',
    'waitlist_confirm',
    'private_booking_outcome'  -- NEW
  ));

COMMIT;
```

> **NOTE:** Before committing, verify the list of existing action values by running:
> `SELECT DISTINCT action FROM guest_tokens` (requires DB access) OR
> `grep -r "action:" src/lib/guest/tokens.ts`
> Adjust the IN list to match reality. The migration MUST preserve every existing action value.

- [ ] **Step 3: Dry-run and commit**

Run: `npx supabase db push --dry-run`

```bash
git add supabase/migrations/20260418120100_pb_outcome_token_action.sql
git commit -m "feat(db): add private_booking_outcome action to guest_tokens"
```

---

### Task 1.3 — DB migration: send idempotency table

**Files:**
- Create: `supabase/migrations/20260418120200_pb_send_idempotency.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260418120200_pb_send_idempotency.sql
BEGIN;

CREATE TABLE private_booking_send_idempotency (
  idempotency_key text PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES private_bookings(id) ON DELETE CASCADE,
  trigger_type text NOT NULL,
  window_key text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_pb_send_idemp_booking ON private_booking_send_idempotency(booking_id);
CREATE INDEX idx_pb_send_idemp_created ON private_booking_send_idempotency(created_at);

COMMENT ON TABLE private_booking_send_idempotency IS
  'Stable business idempotency keys for cron-driven private-booking SMS. '
  'Key format: {booking_id}:{trigger_type}:{window_key}. '
  'Independent of message body so copy refresh does not cause duplicate sends.';

-- RLS: service-role only.
ALTER TABLE private_booking_send_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON private_booking_send_idempotency
  FOR ALL USING (auth.role() = 'service_role');

COMMIT;
```

- [ ] **Step 2: Dry-run and commit**

```bash
npx supabase db push --dry-run
git add supabase/migrations/20260418120200_pb_send_idempotency.sql
git commit -m "feat(db): add private_booking_send_idempotency table

Stable business idempotency key (booking+trigger+window) independent of
message body. Prevents duplicate cron-driven SMS when copy refresh
invalidates the body-hash dedupe lock in SmsQueueService."
```

---

### Task 1.4 — DB migration: delete gate trigger

**Files:**
- Create: `supabase/migrations/20260418120300_pb_delete_gate_trigger.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260418120300_pb_delete_gate_trigger.sql
BEGIN;

CREATE OR REPLACE FUNCTION prevent_hard_delete_when_sms_sent()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM private_booking_sms_queue
    WHERE booking_id = OLD.id
      AND (status = 'sent'
           OR (status = 'approved' AND scheduled_for IS NOT NULL AND scheduled_for > now()))
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: SMS already sent or scheduled. Use cancelBooking instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER private_bookings_delete_gate
  BEFORE DELETE ON private_bookings
  FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete_when_sms_sent();

COMMENT ON FUNCTION prevent_hard_delete_when_sms_sent() IS
  'Blocks hard-delete of private_bookings that have sent or scheduled-future SMS. '
  'Rule: status=sent blocks; status=approved AND scheduled_for>now() blocks. '
  'Other statuses (pending/cancelled/failed) do NOT block.';

COMMIT;
```

- [ ] **Step 2: Dry-run and commit**

```bash
npx supabase db push --dry-run
git add supabase/migrations/20260418120300_pb_delete_gate_trigger.sql
git commit -m "feat(db): add delete-gate trigger on private_bookings

Enforces at DB level that bookings with sent or future-scheduled SMS
cannot be hard-deleted. Server-action guard (coming in Phase 5) is the
primary UX; this trigger is defence-in-depth against direct SQL / future
RPC paths."
```

---

### Task 1.5 — SMS variable sanitiser helper

**Files:**
- Create: `src/lib/sms/sanitise.ts`
- Create: `tests/lib/smsSanitise.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/lib/smsSanitise.test.ts
import { describe, it, expect } from 'vitest'
import { sanitiseSmsVariable } from '@/lib/sms/sanitise'

describe('sanitiseSmsVariable', () => {
  it('returns trimmed value unchanged for clean input', () => {
    expect(sanitiseSmsVariable('Sarah', 100)).toBe('Sarah')
    expect(sanitiseSmsVariable('  Sarah  ', 100)).toBe('Sarah')
  })

  it('strips newlines', () => {
    expect(sanitiseSmsVariable('Sarah\nEvil', 100)).toBe('Sarah Evil')
    expect(sanitiseSmsVariable('A\r\nB', 100)).toBe('A B')
  })

  it('strips tabs and other control chars', () => {
    expect(sanitiseSmsVariable('A\tB', 100)).toBe('A B')
    expect(sanitiseSmsVariable('A\u0007B', 100)).toBe('AB')
  })

  it('collapses multiple whitespace', () => {
    expect(sanitiseSmsVariable('A    B', 100)).toBe('A B')
  })

  it('caps length', () => {
    expect(sanitiseSmsVariable('abcdefghij', 5)).toBe('abcde')
  })

  it('returns empty string for null/undefined/empty', () => {
    expect(sanitiseSmsVariable(null, 100)).toBe('')
    expect(sanitiseSmsVariable(undefined, 100)).toBe('')
    expect(sanitiseSmsVariable('', 100)).toBe('')
  })

  it('handles injection attempts', () => {
    // Malicious name trying to inject extra lines into SMS body
    const malicious = 'Sarah\n\n+44 7000 000000\n\nCall me'
    expect(sanitiseSmsVariable(malicious, 100)).toBe('Sarah +44 7000 000000 Call me')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lib/smsSanitise.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/sms/sanitise.ts

/**
 * Sanitises a string value before interpolation into an SMS body.
 * - Strips ASCII control characters (newlines, tabs, \0-\x1F, \x7F).
 * - Collapses multiple whitespace runs into a single space.
 * - Trims.
 * - Caps length.
 *
 * Use for EVERY user-controlled variable (customer_first_name, event_type, etc.)
 * in SMS templates to prevent body-injection attacks.
 */
export function sanitiseSmsVariable(
  value: string | null | undefined,
  maxLen: number
): string {
  if (!value) return ''
  return value
    .replace(/[\x00-\x1F\x7F]/g, ' ')  // control chars → space
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim()
    .slice(0, maxLen)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lib/smsSanitise.test.ts`
Expected: PASS — all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sms/sanitise.ts tests/lib/smsSanitise.test.ts
git commit -m "feat(sms): add sanitiseSmsVariable helper

Strips control characters, collapses whitespace, caps length. Prevents
SMS body injection via hostile customer names or other user-controlled
template variables."
```

---

### Task 1.6 — Date-TBD detection helper

**Files:**
- Create: `src/lib/private-bookings/tbd-detection.ts`
- Create: `tests/lib/privateBookingsTbdDetection.test.ts`

- [ ] **Step 1: Find the existing DATE_TBD_NOTE constant**

Run: `grep -rn "DATE_TBD_NOTE" src/`
Expected: locate the constant and the string value it wraps.

- [ ] **Step 2: Write failing tests**

```ts
// tests/lib/privateBookingsTbdDetection.test.ts
import { describe, it, expect } from 'vitest'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'

describe('isBookingDateTbd', () => {
  it('returns false when internal_notes is null', () => {
    expect(isBookingDateTbd({ internal_notes: null })).toBe(false)
  })

  it('returns false when internal_notes is empty', () => {
    expect(isBookingDateTbd({ internal_notes: '' })).toBe(false)
  })

  it('returns true when internal_notes contains the TBD note', () => {
    // This assumes DATE_TBD_NOTE is something like '[DATE TBD]'
    // Adjust the fixture to the real value found in Step 1.
    expect(isBookingDateTbd({ internal_notes: '[DATE TBD] customer to confirm' })).toBe(true)
  })

  it('returns true when the TBD note is wrapped in other text', () => {
    expect(isBookingDateTbd({ internal_notes: 'notes\n[DATE TBD]\nmore notes' })).toBe(true)
  })

  it('returns false when other bracketed text is present', () => {
    expect(isBookingDateTbd({ internal_notes: '[TBD] not our marker' })).toBe(false)
  })

  it('handles undefined input gracefully', () => {
    expect(isBookingDateTbd({})).toBe(false)
  })
})
```

- [ ] **Step 3: Run tests — expect failure**

Run: `npx vitest run tests/lib/privateBookingsTbdDetection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/private-bookings/tbd-detection.ts
import { DATE_TBD_NOTE } from '@/services/private-bookings/types'

type BookingLike = {
  internal_notes?: string | null
}

/**
 * Returns true when the booking should be treated as date-TBD.
 * Current convention encodes this in internal_notes by including DATE_TBD_NOTE.
 *
 * Used by:
 *  - cron passes (skip date-based reminders)
 *  - Communications tab (label scheduled section)
 */
export function isBookingDateTbd(booking: BookingLike): boolean {
  if (!booking?.internal_notes) return false
  return booking.internal_notes.includes(DATE_TBD_NOTE)
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `npx vitest run tests/lib/privateBookingsTbdDetection.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/private-bookings/tbd-detection.ts tests/lib/privateBookingsTbdDetection.test.ts
git commit -m "feat(private-bookings): extract isBookingDateTbd helper

Centralises the 'check internal_notes for DATE_TBD_NOTE' convention.
Cron passes and the new Communications tab will both use this — single
source of truth for TBD detection."
```

---

### Task 1.7 — Retire legacy cron routes (requires A4 = yes)

**Files:**
- Delete: `src/app/api/cron/post-event-followup/route.ts`
- Delete: `src/app/api/cron/booking-balance-reminders/route.ts`
- Modify: `vercel.json`

> **Pre-check:** Confirm A4 (approval to retire) = yes. If no, skip this task and add dual-copy-path notes to Task 2.x and 3.x.

- [ ] **Step 1: Review the legacy routes before deletion**

Run: `wc -l src/app/api/cron/post-event-followup/route.ts src/app/api/cron/booking-balance-reminders/route.ts`
Read each file briefly to understand the current behaviour we're moving into the monitor.

- [ ] **Step 2: Delete the routes**

```bash
git rm src/app/api/cron/post-event-followup/route.ts
git rm src/app/api/cron/booking-balance-reminders/route.ts
```

- [ ] **Step 3: Remove from vercel.json**

Open `vercel.json` and remove the two cron entries. Expected structure after removal:

```json
{
  "crons": [
    { "path": "/api/cron/parking-notifications", "schedule": "0 5 * * *" },
    { "path": "/api/cron/rota-auto-close", "schedule": "0 5 * * *" },
    { "path": "/api/cron/rota-manager-alert", "schedule": "0 18 * * 0" },
    { "path": "/api/cron/rota-staff-email", "schedule": "0 21 * * 0" },
    { "path": "/api/cron/private-bookings-weekly-summary", "schedule": "0 * * * *" },
    { "path": "/api/cron/private-booking-monitor", "schedule": "..." }
    // post-event-followup entry REMOVED
    // booking-balance-reminders entry REMOVED
  ]
}
```

- [ ] **Step 4: Verify build and type-check**

Run: `npm run build`
Expected: success, no references to the deleted routes.

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add vercel.json
git commit -m "chore(cron): retire post-event-followup and booking-balance-reminders

Their behaviour folds into private-booking-monitor in Phase 2 (balance
7/1-day reminders → Pass 3) and Phase 4 (review request → Pass 5a/5b).

No copy refresh could be complete while these kept sending old strings
on their own cron schedules."
```

---

### Task 1.8 — Phase 1 verification

- [ ] **Step 1: Run all migrations in a test DB**

Run: `npx supabase db reset --local` (in a clean test DB if available, otherwise dry-run)
Expected: all four Phase 1 migrations apply without error.

- [ ] **Step 2: Verify full test suite still green**

Run: `npm test`
Expected: PASS (new tests pass; no regressions).

- [ ] **Step 3: Verify typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit if anything was fixed**

```bash
git status
# if changes, commit them with "chore: phase 1 cleanup"
```

---

## Phase 2 — Messages module + tone refresh

Purpose: centralise SMS body construction into a pure-function module, apply new copy across every live template, and fold the legacy balance-reminder behaviour into `private-booking-monitor` Pass 3.

---

### Task 2.1 — Messages module scaffolding with 20 builder functions

**Files:**
- Create: `src/lib/private-bookings/messages.ts`
- Create: `tests/lib/privateBookingsMessages.test.ts`

- [ ] **Step 1: Write failing snapshot tests for each builder**

```ts
// tests/lib/privateBookingsMessages.test.ts
import { describe, it, expect } from 'vitest'
import {
  privateBookingCreatedMessage,
  depositReminder7DayMessage,
  depositReminder1DayMessage,
  depositReceivedMessage,
  bookingConfirmedMessage,
  balanceReminder14DayMessage,
  balanceReminder7DayMessage,
  balanceReminder1DayMessage,
  finalPaymentMessage,
  setupReminderMessage,
  dateChangedMessage,
  eventReminder1DayMessage,
  holdExtendedMessage,
  bookingCancelledHoldMessage,
  bookingCancelledRefundableMessage,
  bookingCancelledNonRefundableMessage,
  bookingCancelledManualReviewMessage,
  bookingExpiredMessage,
  bookingCompletedThanksMessage,
  reviewRequestMessage,
} from '@/lib/private-bookings/messages'

describe('privateBookingCreatedMessage', () => {
  it('builds the welcome body with deposit info', () => {
    const body = privateBookingCreatedMessage({
      customerFirstName: 'Sarah',
      eventDate: '12 May 2026',
      depositAmount: 150,
      holdExpiry: '19 April 2026',
    })
    expect(body).toBe(
      "Hi Sarah — your date at The Anchor on 12 May 2026 is penciled in. £150 deposit secures it by 19 April 2026. We'll be in touch with next steps."
    )
  })

  it('falls back to "there" when first name is placeholder', () => {
    const body = privateBookingCreatedMessage({
      customerFirstName: 'guest',
      eventDate: '12 May 2026',
      depositAmount: 150,
      holdExpiry: '19 April 2026',
    })
    expect(body.startsWith('Hi there —')).toBe(true)
  })

  it('sanitises newlines from first name', () => {
    const body = privateBookingCreatedMessage({
      customerFirstName: 'Sarah\n+44 7000 000000',
      eventDate: '12 May 2026',
      depositAmount: 150,
      holdExpiry: '19 April 2026',
    })
    expect(body).not.toContain('\n')
    expect(body).toContain('Sarah +44 7000 000000')
  })
})

describe('bookingCancelledRefundableMessage', () => {
  it('states refund amount and 10-working-day SLA', () => {
    const body = bookingCancelledRefundableMessage({
      customerFirstName: 'Sarah',
      eventDate: '12 May 2026',
      refundAmount: 150,
    })
    expect(body).toBe(
      "Hi Sarah — your booking on 12 May 2026 is cancelled. We'll refund £150 within 10 working days and confirm once it's on the way."
    )
  })
})

describe('bookingCancelledNonRefundableMessage', () => {
  it('states retained amount with booking-terms wording', () => {
    const body = bookingCancelledNonRefundableMessage({
      customerFirstName: 'Sarah',
      eventDate: '12 May 2026',
      retainedAmount: 150,
    })
    expect(body).toContain('£150')
    expect(body).toContain('retained per our booking terms')
  })
})

describe('bookingCancelledManualReviewMessage', () => {
  it('makes no refund promise', () => {
    const body = bookingCancelledManualReviewMessage({
      customerFirstName: 'Sarah',
      eventDate: '12 May 2026',
    })
    expect(body).not.toContain('£')
    expect(body).not.toContain('refund')
    expect(body).toContain('in touch shortly')
  })
})

describe('every message', () => {
  const allMessages = [
    () => privateBookingCreatedMessage({ customerFirstName: 'A', eventDate: 'x', depositAmount: 1, holdExpiry: 'y' }),
    () => depositReminder7DayMessage({ customerFirstName: 'A', eventDate: 'x', depositAmount: 1, daysRemaining: 3 }),
    () => depositReminder1DayMessage({ customerFirstName: 'A', eventDate: 'x', depositAmount: 1 }),
    () => depositReceivedMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => bookingConfirmedMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => balanceReminder14DayMessage({ customerFirstName: 'A', eventDate: 'x', balanceAmount: 1, balanceDueDate: 'y' }),
    () => balanceReminder7DayMessage({ customerFirstName: 'A', eventDate: 'x', balanceAmount: 1, balanceDueDate: 'y' }),
    () => balanceReminder1DayMessage({ customerFirstName: 'A', eventDate: 'x', balanceAmount: 1 }),
    () => finalPaymentMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => setupReminderMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => dateChangedMessage({ customerFirstName: 'A', newEventDate: 'x' }),
    () => eventReminder1DayMessage({ customerFirstName: 'A', guestPart: '' }),
    () => holdExtendedMessage({ customerFirstName: 'A', eventDate: 'x', newExpiryDate: 'y' }),
    () => bookingCancelledHoldMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => bookingCancelledRefundableMessage({ customerFirstName: 'A', eventDate: 'x', refundAmount: 1 }),
    () => bookingCancelledNonRefundableMessage({ customerFirstName: 'A', eventDate: 'x', retainedAmount: 1 }),
    () => bookingCancelledManualReviewMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => bookingExpiredMessage({ customerFirstName: 'A', eventDate: 'x' }),
    () => bookingCompletedThanksMessage({ customerFirstName: 'A' }),
    () => reviewRequestMessage({ customerFirstName: 'A', eventDate: 'x', reviewLink: 'https://g.co/r' }),
  ]

  it.each(allMessages.map((fn, i) => [i, fn]))(
    'message #%i stays under 306 chars',
    (_, fn) => {
      expect(fn().length).toBeLessThanOrEqual(306)
    }
  )

  it.each(allMessages.map((fn, i) => [i, fn]))(
    'message #%i does not start with "The Anchor:"',
    (_, fn) => {
      expect(fn().startsWith('The Anchor:')).toBe(false)
    }
  )
})
```

- [ ] **Step 2: Run tests — expect fail**

Run: `npx vitest run tests/lib/privateBookingsMessages.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// src/lib/private-bookings/messages.ts
import { getSmartFirstName } from '@/lib/sms/bulk'  // or wherever getSmartFirstName is exported
import { sanitiseSmsVariable } from '@/lib/sms/sanitise'

const MAX_FIELD = 80
const MAX_BODY = 306

function name(raw: string | null | undefined): string {
  return getSmartFirstName(sanitiseSmsVariable(raw, MAX_FIELD))
}

function money(n: number): string {
  // £ prefix, no decimals unless non-whole.
  return Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`
}

function cap(body: string): string {
  return body.length <= MAX_BODY ? body : body.slice(0, MAX_BODY - 1) + '…'
}

// --- Templates ---

export function privateBookingCreatedMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  depositAmount: number
  holdExpiry: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your date at The Anchor on ${input.eventDate} is penciled in. ${money(input.depositAmount)} deposit secures it by ${input.holdExpiry}. We'll be in touch with next steps.`
  )
}

export function depositReminder7DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  depositAmount: number
  daysRemaining: number
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — quick nudge. Your hold on ${input.eventDate} expires in ${input.daysRemaining} days. ${money(input.depositAmount)} deposit and the date's yours.`
  )
}

export function depositReminder1DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  depositAmount: number
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your hold on ${input.eventDate} expires tomorrow. Get the ${money(input.depositAmount)} deposit in today and you're locked in.`
  )
}

export function depositReceivedMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — deposit received. ${input.eventDate} is yours. We'll be in touch closer to the time.`
  )
}

export function bookingConfirmedMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(`Hi ${name(input.customerFirstName)} — you're all confirmed for ${input.eventDate}. Can't wait.`)
}

export function balanceReminder14DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  balanceAmount: number
  balanceDueDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — two weeks to go. ${money(input.balanceAmount)} balance due by ${input.balanceDueDate} to keep ${input.eventDate} on track.`
  )
}

export function balanceReminder7DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  balanceAmount: number
  balanceDueDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — one week to go. ${money(input.balanceAmount)} balance still to settle by ${input.balanceDueDate}.`
  )
}

export function balanceReminder1DayMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  balanceAmount: number
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — ${money(input.balanceAmount)} balance due tomorrow for ${input.eventDate}. Get it in today so we can focus on the event.`
  )
}

export function finalPaymentMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — balance paid in full. You're all set for ${input.eventDate} — see you then.`
  )
}

export function setupReminderMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — ${input.eventDate} is nearly here. Send any final setup details our way so we can make it perfect.`
  )
}

export function dateChangedMessage(input: {
  customerFirstName: string | null | undefined
  newEventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking's moved to ${input.newEventDate}. All sorted our end.`
  )
}

export function eventReminder1DayMessage(input: {
  customerFirstName: string | null | undefined
  guestPart: string
}): string {
  const suffix = input.guestPart ? ` ${input.guestPart}` : ''
  return cap(`Hi ${name(input.customerFirstName)} — tomorrow's the day. Everything's ready${suffix}. See you then.`)
}

export function holdExtendedMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  newExpiryDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — good news. We've extended your hold on ${input.eventDate}. New deadline: ${input.newExpiryDate}.`
  )
}

export function bookingCancelledHoldMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your hold on ${input.eventDate} is cancelled. No money changed hands. Shout if you'd like another date.`
  )
}

export function bookingCancelledRefundableMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  refundAmount: number
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking on ${input.eventDate} is cancelled. We'll refund ${money(input.refundAmount)} within 10 working days and confirm once it's on the way.`
  )
}

export function bookingCancelledNonRefundableMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  retainedAmount: number
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking on ${input.eventDate} is cancelled. The ${money(input.retainedAmount)} already paid is retained per our booking terms. We'll be in touch if anything else is outstanding.`
  )
}

export function bookingCancelledManualReviewMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your booking on ${input.eventDate} is cancelled. A member of our team will be in touch shortly to confirm next steps on payment.`
  )
}

export function bookingExpiredMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — your hold on ${input.eventDate} has lapsed. No worries — shout if you'd like to rebook.`
  )
}

export function bookingCompletedThanksMessage(input: {
  customerFirstName: string | null | undefined
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — thanks for choosing The Anchor. Hope it was everything you wanted.`
  )
}

export function reviewRequestMessage(input: {
  customerFirstName: string | null | undefined
  eventDate: string
  reviewLink: string
}): string {
  return cap(
    `Hi ${name(input.customerFirstName)} — glad ${input.eventDate} went well. If you've got 30 seconds, a Google review would mean a lot: ${input.reviewLink}`
  )
}
```

- [ ] **Step 4: Verify `getSmartFirstName` export path**

Run: `grep -rn "export function getSmartFirstName\|export { getSmartFirstName" src/lib/sms/`
Adjust the import path in `messages.ts` if necessary.

- [ ] **Step 5: Run tests — expect pass**

Run: `npx vitest run tests/lib/privateBookingsMessages.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/private-bookings/messages.ts tests/lib/privateBookingsMessages.test.ts
git commit -m "feat(private-bookings): add pure messages module with 20 template builders

All template bodies centralised in one pure module. Each builder accepts
raw booking fields, applies getSmartFirstName() + sanitiseSmsVariable()
internally, caps at 306 chars, drops the 'The Anchor:' opener, and
matches the event-reminder voice (em-dash, first-name-first, earned
exclamation marks).

The module does NOT query DB, read flags, or decide eligibility — pure
string construction only."
```

---

### Task 2.2 — Refactor mutations.ts to call messages module

**Files:**
- Modify: `src/services/private-bookings/mutations.ts`

- [ ] **Step 1: List every SMS body construction in mutations.ts**

Run: `grep -n "smsMessage\|messageBody\|The Anchor:" src/services/private-bookings/mutations.ts`
Expected: ~8 inline string constructions to replace.

- [ ] **Step 2: For each site, replace inline string with messages.ts call**

Example, for booking_created around line 59 — change from:

```ts
const smsMessage = `The Anchor: ${firstName}! Your private booking for ${eventDate} is in — we're excited to host you!`
```

To:

```ts
import { privateBookingCreatedMessage } from '@/lib/private-bookings/messages'
// ...
const smsMessage = privateBookingCreatedMessage({
  customerFirstName: booking.customer_first_name,
  eventDate: eventDateReadable,
  depositAmount: booking.deposit_amount,
  holdExpiry: holdExpiryReadable,
})
```

Repeat for: `booking_confirmed` (line ~615), `setup_reminder` (~550), `date_changed` (~502), `booking_cancelled` path (the `booking_cancelled` generic — Task 3.2 will replace with variant selection), `booking_completed` (~663).

- [ ] **Step 3: Run existing mutation tests**

Run: `npx vitest run tests/services/privateBookingsSmsSideEffects.test.ts`
Expected: FAIL — the tests currently assert the OLD message bodies.

- [ ] **Step 4: Update the existing side-effect tests to assert the NEW bodies**

Open `tests/services/privateBookingsSmsSideEffects.test.ts` and update each assertion to match the output of the `messages.ts` builders. Use the builder output directly as the expected value so tests stay in lock-step with copy.

Example pattern:
```ts
import { privateBookingCreatedMessage } from '@/lib/private-bookings/messages'
// ...
expect(queueCall.message_body).toBe(
  privateBookingCreatedMessage({
    customerFirstName: 'Sarah',
    eventDate: '12 May 2026',
    depositAmount: 150,
    holdExpiry: '19 April 2026',
  })
)
```

- [ ] **Step 5: Run tests — expect pass**

Run: `npx vitest run tests/services/privateBookingsSmsSideEffects.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/private-bookings/mutations.ts tests/services/privateBookingsSmsSideEffects.test.ts
git commit -m "refactor(private-bookings): mutations.ts delegates SMS copy to messages module

All inline SMS body strings in mutations.ts now call the pure builders
from src/lib/private-bookings/messages.ts. No logic changes — new copy
ships at the same time. Existing side-effect tests updated to assert
against builder output so they stay in lock-step with copy changes."
```

---

### Task 2.3 — Refactor payments.ts to call messages module

**Files:**
- Modify: `src/services/private-bookings/payments.ts`

- [ ] **Step 1: List SMS body construction in payments.ts**

Run: `grep -n "smsMessage\|messageBody\|The Anchor:" src/services/private-bookings/payments.ts`
Expected: 2–3 inline constructions (deposit_received, final_payment_received, and the balance-to-completion branch).

- [ ] **Step 2: Replace each with messages module calls**

```ts
import { depositReceivedMessage, finalPaymentMessage } from '@/lib/private-bookings/messages'

// at the deposit_received site:
const smsMessage = depositReceivedMessage({
  customerFirstName: booking.customer_first_name,
  eventDate: eventDateReadable,
})

// at final_payment_received site:
const smsMessage = finalPaymentMessage({
  customerFirstName: booking.customer_first_name,
  eventDate: eventDateReadable,
})
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/services/privateBookingsSmsSideEffects.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/services/private-bookings/payments.ts
git commit -m "refactor(private-bookings): payments.ts delegates SMS copy to messages module"
```

---

### Task 2.4 — Extend Pass 3 of private-booking-monitor with 7/1-day balance reminders + refactor all passes

**Files:**
- Modify: `src/app/api/cron/private-booking-monitor/route.ts`

- [ ] **Step 1: Read the Pass 3 block to understand current structure**

Run: `sed -n '617,735p' src/app/api/cron/private-booking-monitor/route.ts`
Understand the 14-day filter pattern.

- [ ] **Step 2: Replace Pass 3 body construction with messages module calls**

Find the Pass 3 `messageBody` assignment (around line 697) and replace with:

```ts
import {
  balanceReminder14DayMessage,
  balanceReminder7DayMessage,
  balanceReminder1DayMessage,
} from '@/lib/private-bookings/messages'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'

// in Pass 3, pick the correct builder based on days-until-event:
let messageBody: string
let triggerType: string
let windowKey: string
if (daysUntilEvent === 14) {
  triggerType = 'balance_reminder_14day'
  messageBody = balanceReminder14DayMessage({
    customerFirstName: booking.customer_first_name,
    eventDate: eventDateReadable,
    balanceAmount: balanceDue,
    balanceDueDate: balanceDueReadable,
  })
  windowKey = booking.balance_due_date ?? booking.event_date
} else if (daysUntilEvent === 7) {
  triggerType = 'balance_reminder_7day'
  messageBody = balanceReminder7DayMessage({
    customerFirstName: booking.customer_first_name,
    eventDate: eventDateReadable,
    balanceAmount: balanceDue,
    balanceDueDate: balanceDueReadable,
  })
  windowKey = booking.balance_due_date ?? booking.event_date
} else if (daysUntilEvent === 1) {
  triggerType = 'balance_reminder_1day'
  messageBody = balanceReminder1DayMessage({
    customerFirstName: booking.customer_first_name,
    eventDate: eventDateReadable,
    balanceAmount: balanceDue,
  })
  windowKey = booking.event_date
} else {
  continue
}
```

Widen the Pass 3 SELECT to cover 14/7/1 day windows (e.g. `event_date` at 14, 7, or 1 day from today).

- [ ] **Step 3: Add idempotency-key check before send in Pass 3**

Before calling `SmsQueueService.queueAndSend`, insert into `private_booking_send_idempotency`. If the insert violates unique constraint, skip (already sent).

```ts
const idempotencyKey = `${booking.id}:${triggerType}:${windowKey}`
const { error: idempErr } = await supabase
  .from('private_booking_send_idempotency')
  .insert({ idempotency_key: idempotencyKey, booking_id: booking.id, trigger_type: triggerType, window_key: windowKey })

if (idempErr?.code === '23505') {
  // already sent — skip
  continue
}
if (idempErr) {
  logger.error('Idempotency insert failed', { metadata: { bookingId: booking.id, triggerType, error: idempErr } })
  continue
}
```

- [ ] **Step 4: Replace Pass 4 body with messages module**

```ts
import { eventReminder1DayMessage } from '@/lib/private-bookings/messages'

const messageBody = eventReminder1DayMessage({
  customerFirstName: booking.customer_first_name,
  guestPart: booking.guest_count ? `for ${booking.guest_count} guests` : '',
})
```

Add same idempotency key pattern (window_key = event_date).

- [ ] **Step 5: Replace Pass 1 deposit-reminder bodies with messages module**

```ts
import { depositReminder7DayMessage, depositReminder1DayMessage } from '@/lib/private-bookings/messages'

// choose builder by window
```

Same idempotency pattern (window_key = hold_expiry).

- [ ] **Step 6: Add TBD filter to all four passes**

At the top of each pass's SELECT results loop, add:
```ts
if (isBookingDateTbd(booking)) continue
```

- [ ] **Step 7: Run cron tests**

Run: `npx vitest run tests/api/privateBookingMonitorRouteErrors.test.ts`
Expected: PASS (or update tests to match new behaviour; TBD suppression and idempotency should have coverage).

Write a new test file if not existing:

```ts
// tests/api/privateBookingMonitorIdempotency.test.ts
import { describe, it, expect } from 'vitest'
// ... stand up mock supabase + call the route handler twice in sequence;
// verify second run inserts 0 new SMS thanks to idempotency key.
```

- [ ] **Step 8: Commit**

```bash
git add src/app/api/cron/private-booking-monitor/route.ts tests/api/privateBookingMonitorIdempotency.test.ts
git commit -m "feat(cron): extend private-booking-monitor Pass 3 with 7/1-day balance reminders

Pass 3 now fires balance_reminder_14day, _7day, and _1day via the new
messages module. All passes now filter TBD bookings via
isBookingDateTbd() and guard against duplicate sends via the stable
business idempotency key in private_booking_send_idempotency.

Supersedes the retired /api/cron/booking-balance-reminders route."
```

---

### Task 2.5 — Update PrivateBookingMessagesClient template suggestions

**Files:**
- Modify: `src/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx`

- [ ] **Step 1: Find the template list**

Run: `grep -n "template\|suggestion" src/app/\(authenticated\)/private-bookings/\[id\]/messages/PrivateBookingMessagesClient.tsx | head -20`
Locate the array or object that defines SMS template suggestions in the manual-send UI.

- [ ] **Step 2: Replace old-copy strings with the new message builder outputs**

Update the suggestions to call `messages.ts` builders for a set of reasonable default placeholder values. Or, where the suggestion is a fixed string, replace with the new body style (no "The Anchor:" opener, first-name-first, em-dash rhythm).

- [ ] **Step 3: Manually verify in dev**

```bash
npm run dev
# Navigate to a private booking → Messages. Verify template suggestions show new copy.
```

- [ ] **Step 4: Commit**

```bash
git add src/app/\(authenticated\)/private-bookings/\[id\]/messages/PrivateBookingMessagesClient.tsx
git commit -m "chore(ui): update private-booking manual SMS template suggestions to match refreshed copy"
```

---

### Task 2.6 — Phase 2 verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS, no snapshot breakage.

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
# 1. Create a new private booking — verify welcome SMS fires with NEW copy in dev console / SMS log.
# 2. Record a deposit — verify deposit_received SMS with new copy.
# 3. Cancel a booking (use draft booking first) — verify old generic cancelled body still fires
#    (this gets split in Phase 3; Phase 2 leaves cancel on the generic template).
```

---

## Phase 3 — Cancellation split + financial outcome

Purpose: replace the single `booking_cancelled` template with four variants selected by an explicit financial-outcome enum computed from deposit state + payment history + dispute detection.

---

### Task 3.1 — Financial outcome service

**Files:**
- Create: `src/services/private-bookings/financial.ts`
- Create: `tests/services/privateBookingsFinancial.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/services/privateBookingsFinancial.test.ts
import { describe, it, expect, vi } from 'vitest'
import {
  getPrivateBookingPaidTotals,
  getPrivateBookingCancellationOutcome,
  type CancellationFinancialOutcome,
} from '@/services/private-bookings/financial'

// Mock supabase module — use vi.mock pattern consistent with existing tests in tests/services/.

describe('getPrivateBookingPaidTotals', () => {
  it('returns zeros when no deposit and no payments', async () => {
    // mock supabase returning booking with no deposit_paid_date, empty private_booking_payments
    const totals = await getPrivateBookingPaidTotals('booking-1')
    expect(totals).toEqual({
      deposit_paid: 0,
      balance_payments_total: 0,
      total_paid: 0,
      has_open_dispute: false,
    })
  })

  it('includes deposit_amount when deposit_paid_date is set', async () => {
    // mock booking with deposit_paid_date + deposit_amount = 150
    const totals = await getPrivateBookingPaidTotals('booking-2')
    expect(totals.deposit_paid).toBe(150)
    expect(totals.total_paid).toBe(150)
  })

  it('sums balance payments from private_booking_payments', async () => {
    // mock booking with deposit 150 + payments [100, 50]
    const totals = await getPrivateBookingPaidTotals('booking-3')
    expect(totals.balance_payments_total).toBe(150)
    expect(totals.total_paid).toBe(300)
  })
})

describe('getPrivateBookingCancellationOutcome', () => {
  it('returns no_money when nothing paid', async () => {
    // mock booking with deposit_paid_date = null
    const outcome = await getPrivateBookingCancellationOutcome('booking-1')
    expect(outcome.outcome).toBe('no_money')
    expect(outcome.refund_amount).toBe(0)
    expect(outcome.retained_amount).toBe(0)
  })

  it('returns non_refundable_retained when deposit paid (policy: deposit non-refundable)', async () => {
    // mock booking with deposit paid but no balance payment, no dispute
    // (assumes A5 answer is "deposit is always non-refundable on cancellation")
    const outcome = await getPrivateBookingCancellationOutcome('booking-4')
    expect(outcome.outcome).toBe('non_refundable_retained')
    expect(outcome.retained_amount).toBe(150)
    expect(outcome.refund_amount).toBe(0)
  })

  it('returns refundable when balance paid AND balance is refundable', async () => {
    // mock booking with deposit 150 + balance 450, no dispute
    // deposit retained (non-refundable), balance refundable → refund = 450
    const outcome = await getPrivateBookingCancellationOutcome('booking-5')
    expect(outcome.outcome).toBe('refundable')
    expect(outcome.refund_amount).toBe(450)
    expect(outcome.retained_amount).toBe(150)
  })

  it('returns manual_review when has_open_dispute is true', async () => {
    const outcome = await getPrivateBookingCancellationOutcome('booking-6')
    expect(outcome.outcome).toBe('manual_review')
    expect(outcome.refund_amount).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests — expect fail**

Run: `npx vitest run tests/services/privateBookingsFinancial.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the service**

```ts
// src/services/private-bookings/financial.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

export type CancellationFinancialOutcome =
  | 'no_money'
  | 'refundable'
  | 'non_refundable_retained'
  | 'manual_review'

export type PrivateBookingPaidTotals = {
  deposit_paid: number
  balance_payments_total: number
  total_paid: number
  has_open_dispute: boolean
}

export type PrivateBookingCancellationOutcome = {
  outcome: CancellationFinancialOutcome
  refund_amount: number
  retained_amount: number
}

export async function getPrivateBookingPaidTotals(
  bookingId: string
): Promise<PrivateBookingPaidTotals> {
  const db = createAdminClient()

  const { data: booking, error: bErr } = await db
    .from('private_bookings')
    .select('deposit_amount, deposit_paid_date')
    .eq('id', bookingId)
    .single()

  if (bErr || !booking) {
    logger.error('getPrivateBookingPaidTotals: booking not found', { metadata: { bookingId, error: bErr } })
    return { deposit_paid: 0, balance_payments_total: 0, total_paid: 0, has_open_dispute: false }
  }

  const depositPaid = booking.deposit_paid_date ? Number(booking.deposit_amount ?? 0) : 0

  const { data: payments } = await db
    .from('private_booking_payments')
    .select('amount, notes')
    .eq('booking_id', bookingId)

  const balancePaymentsTotal = (payments ?? []).reduce(
    (sum, p) => sum + Number(p.amount ?? 0),
    0
  )

  // Dispute detection: look for payment notes containing "dispute" or "chargeback"
  // or any ledger entry with a negative amount marked as disputed.
  // If a more robust source exists (e.g. Stripe dispute webhook table), use that instead.
  const hasOpenDispute = (payments ?? []).some((p) =>
    typeof p.notes === 'string' && /\b(dispute|chargeback)\b/i.test(p.notes)
  )

  return {
    deposit_paid: depositPaid,
    balance_payments_total: balancePaymentsTotal,
    total_paid: depositPaid + balancePaymentsTotal,
    has_open_dispute: hasOpenDispute,
  }
}

export async function getPrivateBookingCancellationOutcome(
  bookingId: string
): Promise<PrivateBookingCancellationOutcome> {
  const totals = await getPrivateBookingPaidTotals(bookingId)

  if (totals.has_open_dispute) {
    return { outcome: 'manual_review', refund_amount: 0, retained_amount: totals.total_paid }
  }

  if (totals.total_paid === 0) {
    return { outcome: 'no_money', refund_amount: 0, retained_amount: 0 }
  }

  // Policy (A5): deposit is always non-refundable on cancellation.
  // Balance payments ARE refundable unless disputed.
  if (totals.balance_payments_total === 0) {
    // Only deposit paid → fully retained
    return {
      outcome: 'non_refundable_retained',
      refund_amount: 0,
      retained_amount: totals.deposit_paid,
    }
  }

  return {
    outcome: 'refundable',
    refund_amount: totals.balance_payments_total,
    retained_amount: totals.deposit_paid,
  }
}
```

> **NOTE on dispute detection:** The current logic relies on payment notes. If the product has a dedicated dispute/chargeback table or Stripe webhook persistence, replace the regex detection with a proper lookup. Ops fallback: if unsure, the default should be `manual_review` (defensive).

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run tests/services/privateBookingsFinancial.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/private-bookings/financial.ts tests/services/privateBookingsFinancial.test.ts
git commit -m "feat(private-bookings): add financial-outcome service for cancellation

Introduces getPrivateBookingPaidTotals and
getPrivateBookingCancellationOutcome. Returns one of four outcomes:
no_money, refundable, non_refundable_retained, manual_review. Dispute
detection via payment notes (upgradeable to Stripe webhook source when
available)."
```

---

### Task 3.2 — Wire cancellation variants into mutations.ts cancelBooking

**Files:**
- Modify: `src/services/private-bookings/mutations.ts`
- Modify: `tests/services/privateBookingsSmsSideEffects.test.ts`

- [ ] **Step 1: Read current cancelBooking**

Run: `sed -n '858,1020p' src/services/private-bookings/mutations.ts`
Locate the SMS send block (around line 938-1006).

- [ ] **Step 2: Replace the single template with variant selection**

```ts
import { getPrivateBookingCancellationOutcome } from '@/services/private-bookings/financial'
import {
  bookingCancelledHoldMessage,
  bookingCancelledRefundableMessage,
  bookingCancelledNonRefundableMessage,
  bookingCancelledManualReviewMessage,
} from '@/lib/private-bookings/messages'

// Inside cancelBooking(), replace the existing single template block with:
const cancellationOutcome = await getPrivateBookingCancellationOutcome(id)

let messageBody: string
let triggerType: string
let templateKey: string

switch (cancellationOutcome.outcome) {
  case 'no_money':
    triggerType = 'booking_cancelled_hold'
    templateKey = 'private_booking_cancelled_hold'
    messageBody = bookingCancelledHoldMessage({
      customerFirstName: booking.customer_first_name,
      eventDate,
    })
    break
  case 'refundable':
    triggerType = 'booking_cancelled_refundable'
    templateKey = 'private_booking_cancelled_refundable'
    messageBody = bookingCancelledRefundableMessage({
      customerFirstName: booking.customer_first_name,
      eventDate,
      refundAmount: cancellationOutcome.refund_amount,
    })
    break
  case 'non_refundable_retained':
    triggerType = 'booking_cancelled_non_refundable'
    templateKey = 'private_booking_cancelled_non_refundable'
    messageBody = bookingCancelledNonRefundableMessage({
      customerFirstName: booking.customer_first_name,
      eventDate,
      retainedAmount: cancellationOutcome.retained_amount,
    })
    break
  case 'manual_review':
    triggerType = 'booking_cancelled_manual_review'
    templateKey = 'private_booking_cancelled_manual_review'
    messageBody = bookingCancelledManualReviewMessage({
      customerFirstName: booking.customer_first_name,
      eventDate,
    })
    break
}

// Remaining SmsQueueService.queueAndSend call uses triggerType, templateKey, messageBody.
```

- [ ] **Step 3: Also update the status-change cancel path in mutations.ts (~line 639)**

The update flow also transitions to cancelled. Apply the same variant selection there.

- [ ] **Step 4: Extend PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS**

Open `src/services/sms-queue.ts` and add the four new trigger keys:

```ts
const PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS = new Set<string>([
  // ... existing
  'booking_cancelled_hold',
  'booking_cancelled_refundable',
  'booking_cancelled_non_refundable',
  'booking_cancelled_manual_review',
  // retain 'booking_cancelled' for backward compatibility with historical rows
])
```

- [ ] **Step 5: Update tests**

Add test cases to `tests/services/privateBookingsSmsSideEffects.test.ts` for each outcome branch:

```ts
it('sends booking_cancelled_hold when no money paid', async () => { ... })
it('sends booking_cancelled_refundable when balance paid', async () => { ... })
it('sends booking_cancelled_non_refundable when only deposit paid', async () => { ... })
it('sends booking_cancelled_manual_review when dispute open', async () => { ... })
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/services/privateBookingsSmsSideEffects.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/private-bookings/mutations.ts src/services/sms-queue.ts tests/services/privateBookingsSmsSideEffects.test.ts
git commit -m "feat(private-bookings): cancel SMS picks variant based on financial outcome

cancelBooking (and the status-change cancel path) now call
getPrivateBookingCancellationOutcome() and choose one of four templates:
hold, refundable, non_refundable_retained, or manual_review. Customer
gets correct information about refund amount, retention, or manual
handling."
```

---

### Task 3.3 — Phase 3 verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Manual test — cancel each variant in dev**

```bash
npm run dev
# Create four test bookings (no money, deposit-only, deposit+balance, mock dispute)
# Cancel each and verify the correct SMS body in the dev log or SMS queue inspector.
```

---

## Phase 4 — Post-event outcome gate

Purpose: implement the manager-approval gate for review-request SMS. Manager receives email the morning after an event with three one-click confirmations; review SMS only sends for `went_well`.

---

### Task 4.0 — Verify production feature-flag assumption

**Files:** none (investigative)

- [ ] **Step 1: Check Vercel production env**

Run: `vercel env ls production | grep PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED || echo "not set (defaults to false in production)"`

- [ ] **Step 2: Branch on result**

- If unset or `false` → assumption holds. Proceed with Phase 4 at current priority.
- If `true` → review-request SMS are firing in production today without a manager gate. **Stop Phase 2 mid-flight and ship Phase 4 next.** Update the spec's problem statement to match.

- [ ] **Step 3: Record the finding in the commit log**

No commit if no change. If the flag is `true`, add a note to `tasks/todo.md` flagging the priority swap.

---

### Task 4.1 — Extend manager-notifications.ts with outcome email sender

**Files:**
- Modify: `src/lib/private-bookings/manager-notifications.ts`

- [ ] **Step 1: Read the existing manager-notifications module**

Run: `cat src/lib/private-bookings/manager-notifications.ts`
Understand the existing `sendPrivateBookingManagerNotification()` pattern and reuse its HTML/sendEmail wiring.

- [ ] **Step 2: Add the outcome email function**

```ts
// Append to src/lib/private-bookings/manager-notifications.ts
import { createGuestToken } from '@/lib/guest/tokens'
import { sendEmail } from '@/lib/email/emailService'

export async function sendPrivateBookingOutcomeEmail(input: {
  bookingId: string
  customerName: string
  customerFirstName: string
  eventDate: string
  guestCount: number | null
}): Promise<{ success: boolean; tokenIds: string[]; error?: string }> {
  const outcomes: Array<'went_well' | 'issues' | 'skip'> = ['went_well', 'issues', 'skip']
  const tokenIds: string[] = []
  const links: Record<string, string> = {}

  for (const outcome of outcomes) {
    const token = await createGuestToken({
      action: 'private_booking_outcome',
      private_booking_id: input.bookingId,
      expiresInDays: 14,
      metadata: { outcome },
    })
    tokenIds.push(token.id)
    links[outcome] = `${process.env.NEXT_PUBLIC_APP_URL}/api/private-bookings/outcome/${outcome}/${token.rawToken}`
  }

  const html = `
    <p>Hi,</p>
    <p>Did <strong>${input.customerName}</strong>'s event on <strong>${input.eventDate}</strong> go well?</p>
    <p>Guest count: ${input.guestCount ?? 'unknown'}</p>
    <p>Click one:</p>
    <ul>
      <li><a href="${links.went_well}">Yes — went well (send the customer a Google review ask)</a></li>
      <li><a href="${links.issues}">Had issues (do not send review ask)</a></li>
      <li><a href="${links.skip}">Skip (do not send review ask)</a></li>
    </ul>
    <p>Links expire in 14 days.</p>
  `

  const text = [
    `Did ${input.customerName}'s event on ${input.eventDate} go well?`,
    `Guest count: ${input.guestCount ?? 'unknown'}`,
    `Yes — went well: ${links.went_well}`,
    `Had issues: ${links.issues}`,
    `Skip: ${links.skip}`,
    `Links expire in 14 days.`,
  ].join('\n\n')

  const result = await sendEmail({
    to: PRIVATE_BOOKINGS_MANAGER_EMAIL,
    subject: `Did ${input.customerFirstName}'s event go well? — ${input.eventDate}`,
    html,
    text,
  })

  return {
    success: result.success,
    tokenIds,
    error: result.success ? undefined : result.error,
  }
}
```

> **NOTE:** Inspect the existing `createGuestToken()` signature and adapt field names if needed. If it does not accept `metadata`, encode the outcome in the URL path only (pattern `/outcome/{outcome}/{rawToken}`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/private-bookings/manager-notifications.ts
git commit -m "feat(private-bookings): add sendPrivateBookingOutcomeEmail

Sends manager email the morning after an event with three one-click
outcome links (went_well / issues / skip). Uses existing guest_tokens
pattern and manager-notifications abstraction; 14-day link expiry; outcome
in URL path so state intent is explicit."
```

---

### Task 4.2 — GET confirmation + POST mutation route

**Files:**
- Create: `src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts`
- Create: `tests/api/privateBookingOutcomeRoute.test.ts`

- [ ] **Step 1: Write failing integration tests**

```ts
// tests/api/privateBookingOutcomeRoute.test.ts
import { describe, it, expect } from 'vitest'
// ... imports and mocks for supabase admin client + guest_tokens fixtures.

describe('GET /api/private-bookings/outcome/[outcome]/[token]', () => {
  it('renders confirmation page with outcome name', async () => {
    // seed token
    // GET request
    // expect 200 + HTML containing "Mark ... went well"
    // verify post_event_outcome still 'pending' (no mutation)
  })

  it('simulates scanner prefetch (3 GETs from different IPs) without mutating state', async () => {
    // seed 3 tokens for same booking
    // GET each from different IPs
    // expect 3x 200, no booking update
  })

  it('returns 404 for invalid token', async () => { ... })
  it('shows expired page for expired token', async () => { ... })
  it('shows already-recorded page for consumed token', async () => { ... })
})

describe('POST /api/private-bookings/outcome/[outcome]/[token]', () => {
  it('sets post_event_outcome and consumes token', async () => {
    // seed pending booking + 3 tokens
    // POST went_well
    // expect booking.post_event_outcome = 'went_well'
    // expect token consumed_at set
    // expect sibling tokens invalidated
  })

  it('is idempotent — second POST with same token returns already-recorded page', async () => { ... })

  it('first-wins on concurrent POSTs with different outcomes', async () => {
    // seed booking + 3 tokens
    // fire POST went_well and POST issues in parallel
    // expect first-wins behaviour — booking outcome matches only one, NOT last-write-wins
  })

  it('shows booking-changed notice if event_date or status changed since email', async () => { ... })

  it('returns 429 when throttle tripped', async () => { ... })
})
```

- [ ] **Step 2: Run tests — expect fail**

Run: `npx vitest run tests/api/privateBookingOutcomeRoute.test.ts`
Expected: FAIL — route not found.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { hashGuestToken } from '@/lib/guest/tokens'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit'
import { logger } from '@/lib/logger'

const VALID_OUTCOMES = new Set(['went_well', 'issues', 'skip'])

export async function GET(
  request: NextRequest,
  { params }: { params: { outcome: string; token: string } }
) {
  const { outcome, token } = params

  if (!VALID_OUTCOMES.has(outcome)) {
    return renderHtml(404, 'Invalid outcome.')
  }

  const tokenHash = hashGuestToken(token)
  const db = createAdminClient()

  const { data: tokenRow } = await db
    .from('guest_tokens')
    .select('id, private_booking_id, expires_at, consumed_at, metadata')
    .eq('token_hash', tokenHash)
    .eq('action', 'private_booking_outcome')
    .maybeSingle()

  if (!tokenRow) return renderHtml(404, 'This link is invalid or has been replaced.')
  if (tokenRow.consumed_at) return renderHtml(200, 'This decision has already been recorded.')
  if (new Date(tokenRow.expires_at) < new Date()) return renderHtml(200, 'This link has expired.')

  const { data: booking } = await db
    .from('private_bookings')
    .select('customer_name, customer_first_name, event_date, post_event_outcome')
    .eq('id', tokenRow.private_booking_id)
    .maybeSingle()

  if (!booking) return renderHtml(404, 'Booking not found.')
  if (booking.post_event_outcome !== 'pending') {
    return renderHtml(200, `Outcome already recorded as: ${booking.post_event_outcome}.`)
  }

  // Render confirmation page — NO state mutation on GET (email scanner safety).
  const html = `
    <!doctype html>
    <html><head><title>Confirm outcome</title></head>
    <body style="font-family: system-ui; padding: 2rem; max-width: 540px; margin: 0 auto;">
      <h1>Mark as: ${outcome.replace('_', ' ')}?</h1>
      <p>${booking.customer_name}'s event on ${booking.event_date}</p>
      <form method="POST" action="/api/private-bookings/outcome/${outcome}/${token}">
        <button type="submit" style="padding: 0.5rem 1rem; font-size: 1rem;">Confirm</button>
      </form>
    </body></html>
  `
  return new NextResponse(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { outcome: string; token: string } }
) {
  const { outcome, token } = params

  if (!VALID_OUTCOMES.has(outcome)) {
    return renderHtml(400, 'Invalid outcome.')
  }

  const throttle = await checkGuestTokenThrottle({
    request,
    scope: 'private_booking_outcome',
    rawToken: token,
    maxAttempts: 8,
    windowMinutes: 15,
  })
  if (!throttle.allowed) return renderHtml(429, 'Too many attempts. Please wait a few minutes.')

  const tokenHash = hashGuestToken(token)
  const db = createAdminClient()

  const { data: tokenRow } = await db
    .from('guest_tokens')
    .select('id, private_booking_id, expires_at, consumed_at')
    .eq('token_hash', tokenHash)
    .eq('action', 'private_booking_outcome')
    .maybeSingle()

  if (!tokenRow) return renderHtml(404, 'This link is invalid or has been replaced.')
  if (tokenRow.consumed_at) return renderHtml(200, 'This decision has already been recorded.')
  if (new Date(tokenRow.expires_at) < new Date()) return renderHtml(200, 'This link has expired.')

  // Atomic claim: only update if still pending.
  const { data: claimed, error: claimErr } = await db
    .from('private_bookings')
    .update({
      post_event_outcome: outcome,
      post_event_outcome_decided_at: new Date().toISOString(),
    })
    .eq('id', tokenRow.private_booking_id)
    .eq('post_event_outcome', 'pending')
    .select('id, post_event_outcome')
    .maybeSingle()

  if (claimErr) {
    logger.error('Outcome claim failed', { metadata: { tokenId: tokenRow.id, error: claimErr } })
    return renderHtml(500, 'Something went wrong. Please try again.')
  }

  if (!claimed) {
    // Another outcome won. Read current state.
    const { data: current } = await db
      .from('private_bookings')
      .select('post_event_outcome')
      .eq('id', tokenRow.private_booking_id)
      .maybeSingle()
    return renderHtml(200, `Outcome was already recorded as: ${current?.post_event_outcome ?? 'unknown'}.`)
  }

  // Consume this token; invalidate siblings.
  const now = new Date().toISOString()
  await db.from('guest_tokens').update({ consumed_at: now }).eq('id', tokenRow.id)
  await db
    .from('guest_tokens')
    .update({ consumed_at: now })
    .eq('action', 'private_booking_outcome')
    .eq('private_booking_id', tokenRow.private_booking_id)
    .is('consumed_at', null)

  await logAuditEvent({
    user_id: null, // unauthenticated route
    operation_type: 'update',
    resource_type: 'private_booking',
    resource_id: tokenRow.private_booking_id,
    operation_status: 'success',
    additional_info: {
      action: 'post_event_outcome_recorded',
      outcome,
      token_id: tokenRow.id,
      client_ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      user_agent: request.headers.get('user-agent') ?? 'unknown',
    },
  })

  return renderHtml(200, `Recorded: ${outcome.replace('_', ' ')}. Thanks.`)
}

function renderHtml(status: number, message: string): NextResponse {
  const html = `<!doctype html><html><body style="font-family: system-ui; padding: 2rem;"><p>${message}</p></body></html>`
  return new NextResponse(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run tests/api/privateBookingOutcomeRoute.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/private-bookings/outcome/ tests/api/privateBookingOutcomeRoute.test.ts
git commit -m "feat(private-bookings): outcome confirmation route (GET page + POST mutate)

GET renders a confirmation page — no state change — so email scanner
prefetch cannot consume the token. POST performs the atomic claim:
update only if post_event_outcome='pending', first-POST-wins. Losers
render the current recorded outcome. Rate-limited, audited, and
sibling-invalidating."
```

---

### Task 4.3 — Modify Pass 5 of private-booking-monitor (5a + 5b split)

**Files:**
- Modify: `src/app/api/cron/private-booking-monitor/route.ts`
- Create: `tests/api/privateBookingMonitorPass5.test.ts`

- [ ] **Step 1: Read current Pass 5**

Run: `sed -n '820,910p' src/app/api/cron/private-booking-monitor/route.ts`
Understand existing review-request send logic; we're replacing it.

- [ ] **Step 2: Write failing Pass 5 tests**

```ts
// tests/api/privateBookingMonitorPass5.test.ts
import { describe, it, expect } from 'vitest'
// ... mocks for supabase admin + sendPrivateBookingOutcomeEmail + SmsQueueService.

describe('Pass 5a — outcome email send', () => {
  it('sends manager email + creates 3 tokens when event was yesterday, status confirmed, outcome_email_sent_at null', async () => { ... })
  it('skips when outcome_email_sent_at is already set (cron double-fire)', async () => { ... })
  it('skips when booking status is cancelled', async () => { ... })
  it('skips when post_event_outcome is not pending', async () => { ... })
  it('sets outcome_email_sent_at via conditional UPDATE', async () => { ... })
})

describe('Pass 5b — review SMS send', () => {
  it('sends review SMS only when post_event_outcome=went_well, review_sms_sent_at is null, and status != cancelled', async () => { ... })
  it('skips when outcome is issues', async () => { ... })
  it('skips when outcome is skip', async () => { ... })
  it('skips when customer has STOP opt-out', async () => { ... })
  it('sets review_sms_sent_at via conditional UPDATE (not readback + update)', async () => { ... })
})
```

- [ ] **Step 3: Implement Pass 5a**

Replace the existing Pass 5 block with:

```ts
// --- PASS 5a: OUTCOME EMAIL ---
if (!abortState.aborted) {
  const yesterdayLondon = getLondonRunKey(new Date(Date.now() - 24 * 60 * 60 * 1000))
  const { data: eligibleForEmail } = await supabase
    .from('private_bookings')
    .select('id, customer_name, customer_first_name, event_date, guest_count, status, post_event_outcome, outcome_email_sent_at, internal_notes')
    .eq('event_date', yesterdayLondon)
    .eq('status', 'confirmed')
    .eq('post_event_outcome', 'pending')
    .is('outcome_email_sent_at', null)

  for (const booking of eligibleForEmail ?? []) {
    if (isBookingDateTbd(booking)) continue

    const email = await sendPrivateBookingOutcomeEmail({
      bookingId: booking.id,
      customerName: booking.customer_name ?? 'unknown',
      customerFirstName: getSmartFirstName(booking.customer_first_name) ?? 'there',
      eventDate: formatEventDate(booking.event_date),
      guestCount: booking.guest_count,
    })

    if (email.success) {
      // Atomic claim — only update if still null to survive cron double-fire.
      await supabase
        .from('private_bookings')
        .update({ outcome_email_sent_at: new Date().toISOString() })
        .eq('id', booking.id)
        .is('outcome_email_sent_at', null)
    } else {
      logger.error('Outcome email failed', { metadata: { bookingId: booking.id, error: email.error } })
    }
  }
}

// --- PASS 5b: REVIEW SMS ---
if (!abortState.aborted) {
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const today = getLondonRunKey(new Date())

  const { data: eligibleForReview } = await supabase
    .from('private_bookings')
    .select('id, customer_id, customer_first_name, contact_phone, event_date, post_event_outcome, review_sms_sent_at, status')
    .eq('post_event_outcome', 'went_well')
    .is('review_sms_sent_at', null)
    .neq('status', 'cancelled')
    .gte('event_date', fourteenDaysAgo)
    .lte('event_date', today)

  for (const booking of eligibleForReview ?? []) {
    if (!canSendMoreSms()) { stats.smsCapReached = true; break }

    // STOP opt-out check — delegate to sendSMS which already gates.
    const idempotencyKey = `${booking.id}:review_request:${booking.event_date}`
    const { error: idempErr } = await supabase
      .from('private_booking_send_idempotency')
      .insert({ idempotency_key: idempotencyKey, booking_id: booking.id, trigger_type: 'review_request', window_key: booking.event_date })

    if (idempErr?.code === '23505') continue

    // Atomic claim on review_sms_sent_at.
    const { data: claimed } = await supabase
      .from('private_bookings')
      .update({ review_sms_sent_at: new Date().toISOString() })
      .eq('id', booking.id)
      .is('review_sms_sent_at', null)
      .select('id')
      .maybeSingle()

    if (!claimed) continue

    const reviewLink = getGoogleReviewLink()
    const messageBody = reviewRequestMessage({
      customerFirstName: booking.customer_first_name,
      eventDate: formatEventDate(booking.event_date),
      reviewLink,
    })

    await SmsQueueService.queueAndSend({
      booking_id: booking.id,
      trigger_type: 'review_request',
      template_key: 'private_booking_review_request',
      message_body: messageBody,
      customer_phone: booking.contact_phone,
      customer_id: booking.customer_id,
      priority: 3,
      metadata: { template: 'private_booking_review_request', event_date: booking.event_date },
    })
  }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run tests/api/privateBookingMonitorPass5.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/private-booking-monitor/route.ts tests/api/privateBookingMonitorPass5.test.ts
git commit -m "feat(cron): split Pass 5 into 5a (outcome email) + 5b (gated review SMS)

Pass 5a sends the manager outcome email via sendPrivateBookingOutcomeEmail()
the morning after a confirmed event, but ONLY if post_event_outcome is
still pending AND outcome_email_sent_at is null. Uses atomic UPDATE to
survive cron double-fire.

Pass 5b sends the review SMS only when the manager has clicked
'went_well' AND review_sms_sent_at is null AND status != cancelled.
Skips when outcome is issues or skip. Sanity-filters events within last
14 days. Stable idempotency key prevents duplicate sends on copy refresh."
```

---

### Task 4.5 — Weekly ops query for unresponded outcomes

**Files:**
- Create: `src/app/(authenticated)/dashboard/ops-queries/private-bookings-outcomes.ts` (or wherever ops queries live — grep for existing patterns)

- [ ] **Step 1: Find where existing ops queries live**

Run: `grep -rn "pending.*review\|ops query\|weekly.*digest" src/app/\(authenticated\)/dashboard/ src/app/actions/ | head -10`
Locate the existing pattern — there's likely a weekly digest or admin dashboard section.

- [ ] **Step 2: Add query + surface it in the existing digest**

```ts
export async function getStalePendingOutcomes(): Promise<Array<{
  booking_id: string
  customer_name: string
  event_date: string
  outcome_email_sent_at: string
  days_since_email: number
}>> {
  const db = createAdminClient()
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data } = await db
    .from('private_bookings')
    .select('id, customer_name, event_date, outcome_email_sent_at')
    .eq('post_event_outcome', 'pending')
    .lt('outcome_email_sent_at', fourteenDaysAgo)
    .not('outcome_email_sent_at', 'is', null)

  return (data ?? []).map(r => ({
    booking_id: r.id,
    customer_name: r.customer_name,
    event_date: r.event_date,
    outcome_email_sent_at: r.outcome_email_sent_at,
    days_since_email: Math.floor((Date.now() - new Date(r.outcome_email_sent_at).getTime()) / (24 * 60 * 60 * 1000)),
  }))
}
```

- [ ] **Step 3: Surface in the weekly private-bookings digest (existing cron)**

Find `/api/cron/private-bookings-weekly-summary/route.ts` (or similar) and add a "stale pending outcomes" section to the email body, listing counts + booking IDs.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(authenticated\)/dashboard/ops-queries/private-bookings-outcomes.ts
git commit -m "feat(private-bookings): weekly stale-pending-outcomes report

Surface bookings stuck at post_event_outcome='pending' for >14 days
after the manager email was sent. Helps ops spot if manager@the-anchor.pub
is being under-watched before it becomes a problem."
```

---

### Task 4.6 — Phase 4 verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Dev smoke test**

```bash
npm run dev
# 1. Seed a booking with event_date = yesterday, status = confirmed, outcome = pending
# 2. Hit /api/cron/private-booking-monitor manually (with CRON_SECRET auth header)
# 3. Verify email arrives at manager@the-anchor.pub with three links
# 4. Click a link — GET shows confirmation; click Confirm — POST records outcome
# 5. Hit the cron again — review SMS sends only for went_well
```

- [ ] **Step 3: Scanner prefetch simulation**

Manually curl the GET URL three times from three different IPs. Verify booking outcome remains `pending`.

---

## Phase 5 — Deletion gate (UI + action)

Purpose: prevent hard-deleting a booking that has sent SMS to the customer. DB trigger (Task 1.4) is already in place; this phase adds the UI disable + action-layer guard + confirmation modal.

---

### Task 5.1 — Action-layer guard in deletePrivateBooking

**Files:**
- Modify: `src/services/private-bookings/mutations.ts`

- [ ] **Step 1: Update deletePrivateBooking with SMS-sent check**

Locate the existing `deletePrivateBooking` function (around line 1221) and modify:

```ts
export async function deletePrivateBooking(id: string): Promise<{ deletedBooking: any }> {
  const supabase = await createClient()

  // GATE: block if any SMS was sent or is scheduled-future.
  const { data: blockingRows } = await supabase
    .from('private_booking_sms_queue')
    .select('id, status, scheduled_for')
    .eq('booking_id', id)
    .or('status.eq.sent,and(status.eq.approved,scheduled_for.gt.now())')

  if (blockingRows && blockingRows.length > 0) {
    throw new Error(
      `Cannot delete booking: customer has received ${blockingRows.length} SMS message(s). Use Cancel instead so they're notified.`
    )
  }

  // ... rest of function unchanged (calendar cleanup + delete)
}
```

- [ ] **Step 2: Add unit tests**

```ts
// append to tests/services/privateBookingsMutationGuards.test.ts
describe('deletePrivateBooking SMS gate', () => {
  it('throws when a sent SMS exists', async () => {
    // seed booking + queue row with status='sent'
    await expect(deletePrivateBooking('booking-x')).rejects.toThrow(/Cannot delete/)
  })

  it('allows delete when only pending/cancelled/failed queue rows exist', async () => {
    // seed booking + queue rows with status='pending' or 'cancelled'
    await expect(deletePrivateBooking('booking-y')).resolves.toBeDefined()
  })

  it('throws when approved + future-scheduled exists', async () => {
    // seed booking + queue row with status='approved', scheduled_for=tomorrow
    await expect(deletePrivateBooking('booking-z')).rejects.toThrow(/Cannot delete/)
  })
})
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/services/privateBookingsMutationGuards.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/services/private-bookings/mutations.ts tests/services/privateBookingsMutationGuards.test.ts
git commit -m "feat(private-bookings): block delete when SMS already sent

Action-layer guard throws CannotDeleteBookingWithSentSms if any queue
row is status='sent' or (status='approved' AND scheduled_for>now()).
Guides the admin to use Cancel so the customer gets notified. DB trigger
(already in place from Phase 1) is last-line defence."
```

---

### Task 5.2 — UI disable + confirmation modal with date-typing friction

**Files:**
- Modify: `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` (or equivalent)
- Modify: `src/app/actions/privateBookingActions.ts`

- [ ] **Step 1: Find the existing delete button + modal**

Run: `grep -rn "deletePrivateBooking\|Delete booking\|confirm-delete" src/app/\(authenticated\)/private-bookings/`
Locate the action handler + modal component.

- [ ] **Step 2: Add server action to return SMS-sent counts**

In `src/app/actions/privateBookingActions.ts`:

```ts
'use server'
export async function getBookingDeleteEligibility(bookingId: string): Promise<{
  canDelete: boolean
  sentCount: number
  scheduledCount: number
  reason?: string
}> {
  const db = await createClient()
  const { data: { user } } = await db.auth.getUser()
  if (!user) return { canDelete: false, sentCount: 0, scheduledCount: 0, reason: 'Unauthorized' }
  // permission check
  // count sent + scheduled
  const { data } = await db
    .from('private_booking_sms_queue')
    .select('status, scheduled_for')
    .eq('booking_id', bookingId)

  const sentCount = (data ?? []).filter(r => r.status === 'sent').length
  const scheduledCount = (data ?? []).filter(r => r.status === 'approved' && r.scheduled_for && new Date(r.scheduled_for) > new Date()).length

  return {
    canDelete: sentCount === 0 && scheduledCount === 0,
    sentCount,
    scheduledCount,
    reason: sentCount > 0 ? `${sentCount} SMS already sent to customer` : scheduledCount > 0 ? `${scheduledCount} SMS scheduled to send` : undefined,
  }
}
```

- [ ] **Step 3: Wire delete button disabled state**

In `PrivateBookingDetailClient.tsx`, on mount, fetch eligibility and set disabled:

```tsx
const [eligibility, setEligibility] = useState<{ canDelete: boolean; reason?: string } | null>(null)

useEffect(() => {
  getBookingDeleteEligibility(bookingId).then(setEligibility)
}, [bookingId])

<Button
  variant="destructive"
  disabled={!eligibility?.canDelete}
  title={eligibility?.reason ?? ''}
  onClick={() => setShowDeleteModal(true)}
>
  Delete booking
</Button>
```

- [ ] **Step 4: Confirmation modal with date-typing**

```tsx
<Modal open={showDeleteModal} onClose={() => setShowDeleteModal(false)}>
  <h2>Permanently delete booking?</h2>
  <p>Customer was never contacted, so they won't be notified.</p>
  <label>
    To confirm, type the event date ({booking.event_date}):
    <input value={typedDate} onChange={e => setTypedDate(e.target.value)} />
  </label>
  <Button
    variant="destructive"
    disabled={typedDate !== booking.event_date || isSubmitting}
    onClick={handleConfirmDelete}
  >
    Permanently delete
  </Button>
</Modal>
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(authenticated\)/private-bookings/ src/app/actions/privateBookingActions.ts
git commit -m "feat(ui): delete-gate UI with eligibility check and date-typing confirmation

Delete button is disabled with tooltip when SMS has been sent.
Confirmation modal requires typing the event date to confirm (extra
friction on a destructive action). Uses new getBookingDeleteEligibility
server action."
```

---

### Task 5.3 — Phase 5 verification

- [ ] **Step 1: Test delete gate at all three layers**

- UI: button is disabled when booking has sent SMS
- Action: calling `deletePrivateBooking()` throws when gate fails
- DB: direct `DELETE FROM private_bookings WHERE id = 'x'` raises trigger error

- [ ] **Step 2: Full test suite + typecheck + build**

```bash
npm test && npx tsc --noEmit && npm run build
```

Expected: all pass.

---

## Phase 6 — Communications tab + preview modals

Purpose: per-booking Communications tab shows SMS history + scheduled preview. Cancel/Complete/Delete modals show the resolved SMS body before confirm.

---

### Task 6.1 — Scheduled-SMS eligibility helper

**Files:**
- Create: `src/services/private-bookings/scheduled-sms.ts`
- Create: `tests/services/privateBookingsScheduledSms.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// tests/services/privateBookingsScheduledSms.test.ts
import { describe, it, expect } from 'vitest'
import { getBookingScheduledSms } from '@/services/private-bookings/scheduled-sms'

describe('getBookingScheduledSms', () => {
  it('returns deposit_reminder_7day for draft booking with hold_expiry in 4-10 days', async () => { ... })
  it('returns deposit_reminder_1day for draft booking with hold_expiry in 0-2 days', async () => { ... })
  it('returns balance_reminder_14day for confirmed booking with balance outstanding', async () => { ... })
  it('returns event_reminder_1d when event is tomorrow', async () => { ... })
  it('returns review_request when outcome is went_well and review_sms_sent_at is null', async () => { ... })
  it('suppresses with feature_flag_disabled when PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED is off', async () => { ... })
  it('suppresses with date_tbd when isBookingDateTbd', async () => { ... })
  it('suppresses with already_sent when idempotency key already exists', async () => { ... })
  it('returns empty array for cancelled booking', async () => { ... })
})
```

- [ ] **Step 2: Implement**

```ts
// src/services/private-bookings/scheduled-sms.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { isBookingDateTbd } from '@/lib/private-bookings/tbd-detection'
// ... import message builders for preview_body generation

export type ScheduledSmsSuppressionReason =
  | 'feature_flag_disabled'
  | 'date_tbd'
  | 'already_sent'
  | 'stop_opt_out'
  | 'policy_skip'

export type ScheduledSmsPreview = {
  trigger_type: string
  expected_fire_at: string | null
  preview_body: string
  suppression_reason: ScheduledSmsSuppressionReason | null
}

export async function getBookingScheduledSms(
  bookingId: string,
  now: Date = new Date()
): Promise<ScheduledSmsPreview[]> {
  const db = createAdminClient()
  const { data: booking } = await db
    .from('private_bookings')
    .select('*')
    .eq('id', bookingId)
    .single()

  if (!booking || booking.status === 'cancelled') return []

  const isTbd = isBookingDateTbd(booking)
  const flagEnabled =
    process.env.PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED === 'true' ||
    (process.env.NODE_ENV !== 'production' && process.env.PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED !== 'false')

  const { data: idempRows } = await db
    .from('private_booking_send_idempotency')
    .select('idempotency_key, trigger_type, window_key')
    .eq('booking_id', bookingId)
  const alreadySent = new Set((idempRows ?? []).map(r => r.idempotency_key))

  const previews: ScheduledSmsPreview[] = []

  // Deposit reminders (for draft bookings)
  if (booking.status === 'draft' && booking.hold_expiry) {
    const holdExpiry = new Date(booking.hold_expiry)
    const daysUntilExpiry = Math.floor((holdExpiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))

    if (daysUntilExpiry >= 4 && daysUntilExpiry <= 10) {
      // ... build deposit_reminder_7day preview, set suppression if idemp key exists
      previews.push({
        trigger_type: 'deposit_reminder_7day',
        expected_fire_at: /* computed next cron fire */ null,
        preview_body: /* messages.depositReminder7DayMessage(...) */,
        suppression_reason:
          isTbd ? 'date_tbd' :
          alreadySent.has(`${bookingId}:deposit_reminder_7day:${booking.hold_expiry}`) ? 'already_sent' :
          null,
      })
    }
    // similarly for 1-day
  }

  // Balance reminders (confirmed bookings)
  if (booking.status === 'confirmed' && /* balance outstanding */ true) {
    // 14-day, 7-day, 1-day entries
    // suppression_reason: 'feature_flag_disabled' if !flagEnabled
  }

  // Event reminder
  // Review request
  // ... build full list per spec §6.

  return previews
}
```

> **NOTE:** The full body of this function maps 1:1 to the cron eligibility logic. Extract shared helpers where possible; both cron and UI call these.

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/services/privateBookingsScheduledSms.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/services/private-bookings/scheduled-sms.ts tests/services/privateBookingsScheduledSms.test.ts
git commit -m "feat(private-bookings): shared scheduled-SMS eligibility helper

getBookingScheduledSms returns scheduled reminders with resolved preview
bodies and suppression reasons. Called by both cron (Phase 2/4 passes
should migrate to it) and the new Communications tab. Single source of
truth for eligibility logic."
```

---

### Task 6.2 — CommunicationsTab component

**Files:**
- Create: `src/components/private-bookings/CommunicationsTab.tsx`
- Create: `src/components/private-bookings/CommunicationsTabServer.tsx`
- Create: `tests/components/privateBookingsCommunicationsTab.test.tsx`
- Modify: `src/app/(authenticated)/private-bookings/[id]/page.tsx`

- [ ] **Step 1: Write component tests**

```tsx
// tests/components/privateBookingsCommunicationsTab.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CommunicationsTab } from '@/components/private-bookings/CommunicationsTab'

describe('CommunicationsTab', () => {
  it('renders SMS history in reverse chronological order', async () => { ... })
  it('shows empty state when no messages sent', async () => { ... })
  it('renders scheduled list with resolved bodies', async () => { ... })
  it('labels suppressed items with their reason', async () => { ... })
  it('shows date-TBD note when date is TBD', async () => { ... })
  it('paginates history with 50 rows per page', async () => { ... })
})
```

- [ ] **Step 2: Implement server wrapper**

```tsx
// src/components/private-bookings/CommunicationsTabServer.tsx
import { getBookingScheduledSms } from '@/services/private-bookings/scheduled-sms'
import { CommunicationsTab } from './CommunicationsTab'
import { createClient } from '@/lib/supabase/server'

export async function CommunicationsTabServer({ bookingId }: { bookingId: string }) {
  const db = await createClient()
  const { data: history } = await db
    .from('private_booking_sms_queue')
    .select('id, created_at, trigger_type, template_key, status, message_body, twilio_sid, scheduled_for')
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false })
    .limit(50)

  const scheduled = await getBookingScheduledSms(bookingId)

  return <CommunicationsTab history={history ?? []} scheduled={scheduled} />
}
```

- [ ] **Step 3: Implement client component**

```tsx
// src/components/private-bookings/CommunicationsTab.tsx
'use client'
import type { ScheduledSmsPreview } from '@/services/private-bookings/scheduled-sms'

type HistoryRow = {
  id: string
  created_at: string
  trigger_type: string
  status: string
  message_body: string
  twilio_sid: string | null
  scheduled_for: string | null
}

export function CommunicationsTab({
  history,
  scheduled,
}: {
  history: HistoryRow[]
  scheduled: ScheduledSmsPreview[]
}) {
  return (
    <div className="space-y-8">
      <section>
        <h3>History</h3>
        {history.length === 0 ? (
          <p className="text-muted-foreground">No messages sent yet.</p>
        ) : (
          <ul className="space-y-3">
            {history.map((row) => (
              <li key={row.id} className="border rounded p-3">
                <div className="flex justify-between text-sm">
                  <span>{row.trigger_type}</span>
                  <span>{row.status}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{row.message_body}</p>
                <p className="text-xs text-muted-foreground mt-1">{new Date(row.created_at).toLocaleString('en-GB')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Scheduled</h3>
        {scheduled.length === 0 ? (
          <p className="text-muted-foreground">Nothing scheduled.</p>
        ) : (
          <ul className="space-y-3">
            {scheduled.map((item) => (
              <li key={item.trigger_type} className={item.suppression_reason ? 'opacity-60' : ''}>
                <div className="flex justify-between text-sm">
                  <span>{item.trigger_type}</span>
                  <span>{item.expected_fire_at ? `Fires at ${item.expected_fire_at}` : 'Suppressed'}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{item.preview_body}</p>
                {item.suppression_reason && (
                  <p className="text-xs text-warning mt-1">
                    {labelForSuppression(item.suppression_reason)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function labelForSuppression(r: string): string {
  switch (r) {
    case 'feature_flag_disabled': return "Won't send — feature disabled in production."
    case 'date_tbd': return 'No date-based reminders — booking date is TBD.'
    case 'already_sent': return 'Already sent this cycle.'
    case 'stop_opt_out': return 'Customer has opted out of SMS.'
    case 'policy_skip': return 'Policy: no reminder for this case.'
    default: return r
  }
}
```

- [ ] **Step 4: Wire into the booking detail page**

In `src/app/(authenticated)/private-bookings/[id]/page.tsx`, add a new tab "Communications" that renders `<CommunicationsTabServer bookingId={id} />`.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/components/privateBookingsCommunicationsTab.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/private-bookings/ src/app/\(authenticated\)/private-bookings/\[id\]/page.tsx tests/components/privateBookingsCommunicationsTab.test.tsx
git commit -m "feat(ui): add Communications tab to private booking detail page

New tab shows SMS history (reverse-chronological from
private_booking_sms_queue) and scheduled reminders (via
getBookingScheduledSms). Scheduled items show resolved preview bodies
and are labelled with suppression reasons (feature flag, date TBD,
already sent, STOP opt-out)."
```

---

### Task 6.3 — Pre-action preview modals

**Files:**
- Modify: `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`

- [ ] **Step 1: Extend Cancel confirmation modal**

When the cancel button is clicked, fetch the cancellation outcome + resolved body via a server action:

```ts
// src/app/actions/privateBookingActions.ts
'use server'
export async function getCancellationPreview(bookingId: string): Promise<{
  outcome: CancellationFinancialOutcome
  refund_amount: number
  retained_amount: number
  preview_body: string
}> {
  // call getPrivateBookingCancellationOutcome + corresponding messages.ts builder
}
```

Modal shows the preview body + amount info:

```tsx
<Modal open={showCancelModal}>
  <h2>Cancel this booking?</h2>
  <p>Outcome: {preview?.outcome}</p>
  {preview?.refund_amount > 0 && <p>Refund: £{preview.refund_amount}</p>}
  {preview?.retained_amount > 0 && <p>Retained: £{preview.retained_amount}</p>}
  <label>Customer will receive:</label>
  <pre className="whitespace-pre-wrap border rounded p-3">{preview?.preview_body}</pre>
  <Button variant="destructive" onClick={handleConfirm}>Cancel booking and send SMS</Button>
</Modal>
```

- [ ] **Step 2: Extend Complete modal**

```tsx
<Modal open={showCompleteModal}>
  <h2>Mark as complete?</h2>
  <label>Customer will receive:</label>
  <pre>{bookingCompletedThanksMessage({ customerFirstName: booking.customer_first_name })}</pre>
  <p className="text-sm text-muted-foreground">
    A separate decision email about Google reviews will be sent to the manager the next morning.
  </p>
</Modal>
```

- [ ] **Step 3: Commit**

```bash
git add src/app/\(authenticated\)/private-bookings/\[id\]/PrivateBookingDetailClient.tsx src/app/actions/privateBookingActions.ts
git commit -m "feat(ui): show resolved SMS preview in cancel/complete/delete modals

Admin sees the exact SMS body the customer will receive before
confirming the action. Cancel modal also shows the computed refund or
retention amount."
```

---

### Task 6.4 — Phase 6 verification

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Manual UI walkthrough**

```bash
npm run dev
# 1. Open a private booking — see Communications tab
# 2. Verify history + scheduled are shown correctly
# 3. Open cancel modal — verify SMS preview matches the outcome
# 4. Open complete modal — verify preview + outcome email note
# 5. Open delete modal on a booking with SMS — verify disabled with tooltip
# 6. Open delete modal on a fresh booking — verify date-typing confirmation works
```

- [ ] **Step 3: Accessibility pass**

- Keyboard navigation: can you tab to each interactive element in the tab and modals?
- Focus trap in modals?
- ARIA labels on icon-only buttons?

- [ ] **Step 4: Final commit if any polish**

```bash
git status
# Commit any remaining polish items
```

---

## Post-phase cleanup

### Task 7.1 — Spec sync + cleanup

- [ ] **Step 1: Update spec open-questions table**

Open `docs/superpowers/specs/2026-04-18-private-bookings-sms-redesign-design.md`, mark A1–A6 with their final answers from the pre-work.

- [ ] **Step 2: Archive adversarial review artefacts**

No action — artefacts live in `tasks/codex-qa-review/` and stay there for audit.

- [ ] **Step 3: Final verification pipeline**

```bash
npm run lint && npx tsc --noEmit && npm test && npm run build
```

Expected: all green.

- [ ] **Step 4: Final commit**

```bash
git add docs/superpowers/specs/
git commit -m "docs: sync private-bookings SMS redesign spec open questions"
```

---

## Self-Review Checklist

Before marking this plan done, verify:

- [ ] Every success criterion in the spec maps to at least one task above.
- [ ] Every BLOCKER in the adversarial review's "Recommended Fix Order" is addressed by a task.
- [ ] Every SPEC-1 through SPEC-20 item from the claude-handoff brief has a task or is surfaced via the open-questions pre-work.
- [ ] All 20 templates in the spec's §8 inventory have a builder function in Task 2.1.
- [ ] All three cron routes (monitor + 2 legacy) are accounted for: modified or deleted.
- [ ] Data model migration (4 new columns, 1 enum extension, 1 idempotency table, 1 trigger) is four separate migration files with separate commits.
- [ ] Cancellation has four variants (hold / refundable / non_refundable / manual_review), not two.
- [ ] Outcome route uses GET-confirm + POST-mutate (email scanner safe).
- [ ] Idempotency key for cron sends is body-independent (survives copy refresh).
- [ ] Delete gate enforced at three layers (UI / action / DB trigger).
- [ ] `ensureReplyInstruction` is NOT claimed to append anything — length budget is 306 for body only.
- [ ] `getSmartFirstName()` used in every template; never raw `firstName` passthrough.
- [ ] `sanitiseSmsVariable()` used on every user-controlled template variable.
- [ ] Shared helper `getBookingScheduledSms()` used by both cron (eventually) and UI.

If any item is missing, add the task inline before shipping the plan.
