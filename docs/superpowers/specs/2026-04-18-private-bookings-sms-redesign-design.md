# Private Bookings SMS Redesign

**Date**: 2026-04-18
**Status**: Approved 2026-04-18 — ready for implementation. Post-adversarial-review revision (see `tasks/codex-qa-review/2026-04-18-private-bookings-sms-redesign-*.md`). All open questions closed.
**Complexity**: L (4) — touches cron routes (3 of them), service mutations, payments, admin UI, email abstraction, DB schema (4 new columns, 1 extended enum, 1 new trigger), retirement of 2 legacy routes. ~12–16 files.

---

## Problem Statement

Private bookings send SMS across three cron routes and several action paths. Over time, three problems have accumulated that make the current communication weak and risky to expand:

1. **Review-request flow is disabled in production by a feature flag (`PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED`).** Before that flag can be safely turned on, we need a manager-approval gate so review requests don't go out for events that didn't go well. Current Pass 5 of `private-booking-monitor` is technically wired but has no "did it go well?" check — turning on the flag today would send a Google-review ask for every event regardless of outcome.

2. **Cancellation copy is undifferentiated** — a customer whose unpaid hold lapsed and a customer who paid a deposit and is owed a refund both get "hope to see you soon" with no refund timing, amount, or policy information.

3. **Delete vs cancel is a policy ambiguity** — `deletePrivateBooking()` hard-deletes rows with no SMS check. A booking that has messaged the customer can be wiped, leaving them believing it still exists.

There are also three code-path problems the redesign must address to deliver anything coherent:

- **Two legacy cron routes are still scheduled in `vercel.json` and actively sending old-copy SMS** — `/api/cron/post-event-followup` sends `post_event_followup`, `/api/cron/booking-balance-reminders` sends `balance_reminder_7day` and `balance_reminder_1day`. Copy refresh cannot be "complete" while these keep running.
- **The dedupe lock hashes message body** — deploying new copy for an existing trigger invalidates dedupe, risking duplicate sends during the deploy window.
- **Tone and opener drift** — most templates lead with `"The Anchor: {firstName}!"`. Event-reminder SMS have moved toward first-name-first, em-dash rhythm, earned exclamation marks. Private bookings should match.

> **Open question (A1)**: Confirm whether `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` is `true` or `false` in production. If `true`, today's Pass 5 is sending ungated review asks and this spec upgrades to P0. If `false` (current default), this spec is an enablement + correctness pre-req.

## Success Criteria

- No customer receives a Google-review request unless the booking manager has explicitly confirmed the event went well (via one of three actions in a manager email).
- A customer whose booking is cancelled after paying receives SMS copy that states the refund amount and timing — with distinct variants for "refundable", "non-refundable retained per policy", and "manual review (disputed payment)".
- A booking that has sent SMS to the customer with `status = 'sent'` (or has an approved + scheduled future send) cannot be hard-deleted from any admin path — including direct DB-level bypass, enforced by trigger.
- Every live SMS template drops the `"The Anchor: "` opener and matches the voice used in event-reminder SMS (warm, first-name-first, em-dash rhythm, earned exclamation marks). This includes copy in `private-booking-monitor`, `post-event-followup` (or whatever replaces it), `booking-balance-reminders` (or whatever replaces it), `mutations.ts`, and `payments.ts`.
- Admin can open a Communications tab on any booking and see every SMS sent plus every SMS scheduled, via a shared server helper used by cron eligibility logic.
- Admin can see a preview of the exact SMS that will fire before confirming cancel, complete, or delete actions.
- Date-TBD private bookings never receive date-based reminders. Detection uses the existing `internal_notes` convention (`DATE_TBD_NOTE`).
- Deploying copy changes never produces duplicate sends — cron-driven sends use a body-independent idempotency key.

## Scope

### In scope
- Manager-approval gate for review request (new DB fields, manager email via existing `manager-notifications.ts` abstraction, outcome links via existing `guest_tokens` with new action type).
- Cancellation copy split into four variants based on a financial-outcome enum (hold / refundable / non-refundable-retained / manual-review).
- Deletion gate: UI disable + action guard + DB trigger enforcing "no hard-delete if `status = 'sent'` SMS exists".
- Tone/opener refresh across every live template, including templates in the two legacy cron routes.
- Communications tab per booking (history from `private_booking_sms_queue`, scheduled via shared server helper that encodes all cron eligibility logic).
- Pre-action preview modal on cancel/complete/delete.
- Shared `isBookingDateTbd()` helper (note-based detection).
- Retirement of `/api/cron/post-event-followup` and `/api/cron/booking-balance-reminders` — routes deleted, `vercel.json` entries removed, reminder logic folded into `private-booking-monitor`.
- Stable business idempotency key for cron-driven sends (independent of body hash).
- Manual send UI in `PrivateBookingMessagesClient.tsx` gets updated copy/suggestions (template suggestions only, no new send triggers).

### Out of scope
- Staff/venue SMS or push notifications.
- SMS opt-out / marketing preferences configuration for private bookings (existing STOP handling is preserved; we only add a test proving review SMS respects it).
- New manual ad-hoc SMS send triggers.
- Short-link service for payment URLs.
- Two-way SMS / reply-to-book flows.
- Email template redesign beyond the manager outcome email.
- Contract-sent SMS (contracts remain email-only).

---

## Current State (baseline, verified against codebase)

### Live customer-facing SMS (action-driven, in `PRIVATE_BOOKING_SMS_AUTO_SEND_TRIGGERS`)

Action-driven SMS fired from `mutations.ts` and `payments.ts`: `booking_created`, `deposit_received`, `booking_confirmed`, `final_payment_received`, `setup_reminder`, `date_changed`, `booking_cancelled`, `booking_expired`, `hold_extended`, `booking_completed`. All currently prefix `"The Anchor: {firstName}!"`.

### Live cron-driven SMS (three separate routes)

- **`/api/cron/private-booking-monitor`** (five passes): Pass 1 deposit reminders (`deposit_reminder_7day`, `deposit_reminder_1day`), Pass 2 expiry (`booking_expired`), Pass 3 balance reminder (`balance_reminder_14day`), Pass 4 event reminder (`event_reminder_1d`), Pass 5 post-event review (`post_event_followup`). Passes 3/4/5 gated by `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` (default OFF in production). Pass 5 also guarded by `review_processed_at IS NULL`.
- **`/api/cron/post-event-followup`** (legacy): sends `post_event_followup` via `SmsQueueService`.
- **`/api/cron/booking-balance-reminders`** (legacy): sends `balance_reminder_7day` and `balance_reminder_1day`.

### Safeguards already in place (do not rewrite)
- 15-minute dedupe lock per trigger+booking+template+phone+**message_body** in `SmsQueueService` (body-inclusive — see §11 below).
- `sendSMS()` in `src/lib/twilio.ts` applies `evaluateSmsQuietHours()` to all sends.
- Per-run cap: `MAX_PRIVATE_BOOKING_SMS_PER_RUN` (default 120).
- Idempotency guard on `booking_completed` via queue lookup.
- `getSmartFirstName()` normalises placeholder names ("guest", "customer", "unknown") to "there".
- `checkGuestTokenThrottle` rate-limits token-based routes (production fails closed on DB error).
- `private_booking_sms_queue` statuses are `pending`, `approved`, `sent`, `cancelled`, `failed`.

### Existing columns on `private_bookings` relevant to this redesign
`deposit_amount`, `deposit_paid_date`, `final_payment_date`, `balance_due_date`, `hold_expiry`, `customer_first_name`, `contact_phone`, `event_date`, `status`, `cancellation_reason`, `cancelled_at`, `review_processed_at`, `review_clicked_at`. (No `total_paid` column; no `is_date_tbd` column.)

### Existing abstractions we will reuse
- `src/lib/private-bookings/manager-notifications.ts` — `sendPrivateBookingManagerNotification()` + `PRIVATE_BOOKINGS_MANAGER_EMAIL` constant.
- `src/lib/guest/tokens.ts` — `createGuestToken()`, `hashGuestToken()`, action-type enum.
- `src/lib/guest/token-throttle.ts` — `checkGuestTokenThrottle()` by scope + token hash + IP.
- `src/lib/sms/name-utils.ts` — `getSmartFirstName()`.
- `src/lib/private-bookings/feedback.ts` — pattern for private-booking token flow (token create retired; preview/submission pattern remains).

### `ensureReplyInstruction()` is a no-op
It currently just trims the message. Any SMS-length planning must budget the full 306 chars as message only — no suffix is appended.

---

## Design

### 1. Data model changes

```sql
-- Add columns to private_bookings
ALTER TABLE private_bookings
  ADD COLUMN post_event_outcome text
    CHECK (post_event_outcome IN ('pending','went_well','issues','skip'))
    DEFAULT 'pending',
  ADD COLUMN post_event_outcome_decided_at timestamptz,
  ADD COLUMN outcome_email_sent_at timestamptz,
  ADD COLUMN review_sms_sent_at timestamptz;

-- Backfill: rows that already had a review processed before this migration
UPDATE private_bookings
  SET post_event_outcome = 'skip',
      post_event_outcome_decided_at = review_processed_at
  WHERE review_processed_at IS NOT NULL;
```

The existing `review_processed_at` becomes the terminal "handled" flag (the pre-redesign Pass 5 check continues to work during migration). New review gating uses `post_event_outcome = 'went_well'` AND `review_sms_sent_at IS NULL`.

```sql
-- Extend guest_tokens action enum
ALTER TABLE guest_tokens
  DROP CONSTRAINT guest_tokens_action_check;
ALTER TABLE guest_tokens
  ADD CONSTRAINT guest_tokens_action_check
  CHECK (action IN (<existing actions>, 'private_booking_outcome'));
```

```sql
-- Stable idempotency key table for cron-driven sends (independent of body hash)
CREATE TABLE private_booking_send_idempotency (
  idempotency_key text PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES private_bookings(id) ON DELETE CASCADE,
  trigger_type text NOT NULL,
  window_key text NOT NULL,  -- e.g. "2026-05-12" for event_date-anchored windows
  created_at timestamptz DEFAULT now()
);
```

```sql
-- Delete gate: DB trigger
CREATE OR REPLACE FUNCTION prevent_hard_delete_when_sms_sent()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM private_booking_sms_queue
    WHERE booking_id = OLD.id
      AND (status = 'sent'
           OR (status = 'approved' AND scheduled_for > now()))
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
```

No new `private_booking_outcome_tokens` table — `guest_tokens` handles it.

### 2. Post-event review gate

#### Flow

```
Day of event ends
    │
    ▼
Next day 09:00 London — private-booking-monitor Pass 5a (MODIFIED)
    │
    ├─ For bookings where event_date = yesterday AND post_event_outcome = 'pending'
    │   AND outcome_email_sent_at IS NULL AND status != 'cancelled':
    │     1. Generate 3 guest_tokens (action = 'private_booking_outcome', expires in 14 days)
    │     2. Call sendPrivateBookingOutcomeEmail() in manager-notifications.ts
    │     3. Conditional UPDATE: SET outcome_email_sent_at = now()
    │        WHERE id = $id AND outcome_email_sent_at IS NULL
    │        (atomic claim; losing concurrent cron run is a no-op)
    │
    └─ No customer SMS in this pass

Manager clicks link (within 14 days)
    │
    ▼
GET /api/private-bookings/outcome/{outcome}/{token}
    │
    ├─ Renders a confirmation page with the outcome selected + "Confirm" button.
    │  NO state mutation on GET. Email-scanner-safe.
    │
    └─ Confirm button submits POST

POST /api/private-bookings/outcome/{outcome}/{token}
    1. Throttle check (scope = 'private_booking_outcome', 8 per 15 minutes by token+IP)
    2. Validate token shape; hash; look up guest_tokens row
    3. If not found / expired / consumed → render "already recorded / expired"
    4. Re-read booking state. If event_date or status changed since email sent,
       render "booking changed — review decision please" confirmation.
    5. Conditional UPDATE (atomic claim):
         UPDATE private_bookings
         SET post_event_outcome = $outcome,
             post_event_outcome_decided_at = now()
         WHERE id = $booking_id AND post_event_outcome = 'pending'
       If 0 rows affected → render "already recorded as {current_outcome}"
    6. Mark guest_tokens row consumed; invalidate sibling outcome tokens for same booking
    7. Durable audit log entry via logAuditEvent (booking_id, outcome, previous_outcome,
       token_id, client_ip, user_agent, timestamp)
    8. Render success HTML

Next daily cron — Pass 5b (NEW)
    │
    └─ For bookings where post_event_outcome = 'went_well'
         AND review_sms_sent_at IS NULL
         AND status != 'cancelled'
         AND event_date within last 14 days
         AND customer STOP opt-out not set:
           1. Conditional UPDATE claim: SET review_sms_sent_at = now()
              WHERE id = $id AND review_sms_sent_at IS NULL
              (atomic claim before send)
           2. Send review SMS via SmsQueueService (body built by messages.ts)
           3. Stable idempotency key: {booking_id}:review_request:{event_date_iso}
```

#### Manager email

- **To**: `PRIVATE_BOOKINGS_MANAGER_EMAIL` from `manager-notifications.ts` (currently `manager@the-anchor.pub`).
- **Sender function**: new `sendPrivateBookingOutcomeEmail()` added to `manager-notifications.ts`.
- **Subject**: `Did {customer_name}'s event go well? — {event_date}`
- **Content**: customer first name, event date, guest count. No phone/email/payment details.
- **Links**: three buttons pointing to `GET /api/private-bookings/outcome/{outcome}/{token}` (confirmation pages, not mutating).
- **Idempotency**: `outcome_email_sent_at IS NULL` guard + conditional UPDATE = no duplicate emails on cron double-fire.

### 3. Cancellation copy with financial-outcome enum

New service module `src/services/private-bookings/financial.ts`:

```ts
type CancellationFinancialOutcome =
  | 'no_money'             // nothing paid, hold lapse or draft cancel
  | 'refundable'           // paid; amount determinable; stated SLA applies
  | 'non_refundable_retained'  // paid; policy says we keep it (e.g. deposit non-refundable)
  | 'manual_review'        // disputed/chargeback/reconciliation mismatch

export async function getPrivateBookingPaidTotals(bookingId: string): Promise<{
  deposit_paid: number
  balance_payments_total: number
  total_paid: number
  has_open_dispute: boolean
}>

export async function getPrivateBookingCancellationOutcome(bookingId: string): Promise<{
  outcome: CancellationFinancialOutcome
  refund_amount: number  // 0 for no_money / non_refundable_retained / manual_review
  retained_amount: number  // for non_refundable_retained variant
}>
```

`cancelBooking()` calls `getPrivateBookingCancellationOutcome()` and picks the template:

| Outcome | Template | Example body |
|---------|----------|--------------|
| `no_money` | `private_booking_cancelled_hold` | `Hi {firstName} — your hold on {event_date} is cancelled. No money changed hands. Shout if you'd like another date.` |
| `refundable` | `private_booking_cancelled_refundable` | `Hi {firstName} — your booking on {event_date} is cancelled. We'll refund £{refund_amount} within 10 working days and confirm once it's on the way.` |
| `non_refundable_retained` | `private_booking_cancelled_non_refundable` | `Hi {firstName} — your booking on {event_date} is cancelled. The £{retained_amount} already paid is retained per our booking terms. We'll be in touch if anything else is outstanding.` |
| `manual_review` | `private_booking_cancelled_manual_review` | `Hi {firstName} — your booking on {event_date} is cancelled. A member of our team will be in touch shortly to confirm next steps on payment.` |

Dispute detection: the `has_open_dispute` flag is derived from Stripe/PayPal payment records where available; if detection isn't reliable, we default to `manual_review` whenever `total_paid > 0` and no successful refund ledger entry exists.

### 4. Deletion gate

**Real queue statuses** (`pending`, `approved`, `sent`, `cancelled`, `failed`). Rules:

- **Blocks hard delete**: any row with `status = 'sent'` OR (`status = 'approved'` AND `scheduled_for > now()`).
- **Does not block but shown as advisory in tooltip**: rows with `status = 'pending'`, `cancelled`, or `failed`.

Three layers of enforcement:

1. **UI layer** (`PrivateBookingDetailClient.tsx` or similar): delete button disabled if blocking rows exist, tooltip shows counts and sends "Use Cancel instead".
2. **Action layer** (`deletePrivateBooking()` in `mutations.ts`): server-side check, throws `CannotDeleteBookingWithSentSms` if blocked.
3. **DB layer** (trigger `prevent_hard_delete_when_sms_sent`): last-line defense against any future RPC or direct-SQL bypass.

Confirmation modal requires typing the event date (`YYYY-MM-DD`) for extra friction on legitimate deletes. Audit log records actor, reason, and any advisory-not-blocking SMS counts.

### 5. Tone and opener refresh

**Voice principles** (derived from existing event-reminder SMS, matched across the redesign):
- First-name first. Never lead with `"The Anchor:"`.
- Em-dash for rhythm.
- One exclamation mark max per message; ceremonial messages can have zero.
- Action messages lead with the fact.
- Bad-news messages offer a path forward.
- Length cap: ≤306 chars per message, no suffix appended (`ensureReplyInstruction` is a no-op and we budget accordingly).
- Control-character sanitisation: every template variable passes through a helper that collapses whitespace and strips `\n`, `\r`, `\t`, etc. before interpolation — prevents malicious first-name injection.
- First name via `getSmartFirstName()`.

### 6. Communications tab (per-booking UI)

New tab on the booking detail page, powered by a server-side helper `getBookingScheduledSms(bookingId, now)` that both the cron eligibility logic and the UI call. Single source of truth.

Helper returns:
```ts
type ScheduledSmsPreview = {
  trigger_type: string
  expected_fire_at: string | null  // null if suppression_reason blocks it
  preview_body: string
  suppression_reason: null | 'feature_flag_disabled' | 'date_tbd' | 'already_sent' | 'stop_opt_out' | 'policy_skip'
}
```

**History section** (reverse-chronological): rows from `private_booking_sms_queue`.
**Scheduled section**: rows returned by `getBookingScheduledSms()`. Suppressed items are labelled (e.g. "Won't send — feature disabled in production.").

Pagination: server-side, 50 rows per page for history, count + load-more pattern. Scheduled list is never paginated (max ~6 items).

Empty states:
- Empty history: "No messages sent yet."
- Empty scheduled + date-TBD booking: "No date-based reminders scheduled (booking date is TBD)."
- Empty scheduled + fixed-date booking: "Nothing scheduled."

### 7. Pre-action preview modal

Cancel / Complete / Delete modals extend existing confirmation dialogs with the resolved body the action will trigger.

- **Cancel**: body of the selected variant from §3 based on live `getPrivateBookingCancellationOutcome()` call.
- **Complete**: body of `booking_completed_thanks`. Plus note: "A separate decision email about Google reviews will be sent to the manager the next morning."
- **Delete**: no SMS preview (none sent). Note: "Customer was never contacted." Delete button only enabled if gate allows.

### 8. Full message inventory (new copy)

All templates go through the sanitisation helper (control chars stripped, length capped). First names via `getSmartFirstName()`. No `"The Anchor:"` prefix on any message. No reply-instruction suffix (helper is no-op).

| Template key | Trigger | New body |
|--------------|---------|----------|
| `private_booking_created` | `booking_created` | `Hi {firstName} — your date at The Anchor on {event_date} is penciled in. £{deposit_amount} deposit secures it by {hold_expiry}. We'll be in touch with next steps.` |
| `private_booking_deposit_reminder_7day` | `deposit_reminder_7day` | `Hi {firstName} — quick nudge. Your hold on {event_date} expires in {days_remaining} days. £{deposit_amount} deposit and the date's yours.` |
| `private_booking_deposit_reminder_1day` | `deposit_reminder_1day` | `Hi {firstName} — your hold on {event_date} expires tomorrow. Get the £{deposit_amount} deposit in today and you're locked in.` |
| `private_booking_deposit_received` | `deposit_received` | `Hi {firstName} — deposit received. {event_date} is yours. We'll be in touch closer to the time.` |
| `private_booking_confirmed` | `booking_confirmed` | `Hi {firstName} — you're all confirmed for {event_date}. Can't wait.` |
| `private_booking_balance_reminder_14day` | `balance_reminder_14day` | `Hi {firstName} — two weeks to go. £{balance_amount} balance due by {balance_due_date} to keep {event_date} on track.` |
| `private_booking_balance_reminder_7day` | `balance_reminder_7day` (folded into monitor) | `Hi {firstName} — one week to go. £{balance_amount} balance still to settle by {balance_due_date}.` |
| `private_booking_balance_reminder_1day` | `balance_reminder_1day` (folded into monitor) | `Hi {firstName} — £{balance_amount} balance due tomorrow for {event_date}. Get it in today so we can focus on the event.` |
| `private_booking_final_payment` | `final_payment_received` | `Hi {firstName} — balance paid in full. You're all set for {event_date} — see you then.` |
| `private_booking_setup_reminder` | `setup_reminder` | `Hi {firstName} — {event_date} is nearly here. Send any final setup details our way so we can make it perfect.` |
| `private_booking_date_changed` | `date_changed` | `Hi {firstName} — your booking's moved to {new_event_date}. All sorted our end.` |
| `private_booking_event_reminder_1d` | `event_reminder_1d` | `Hi {firstName} — tomorrow's the day. Everything's ready{guest_part}. See you then.` |
| `private_booking_hold_extended` | `hold_extended` | `Hi {firstName} — good news. We've extended your hold on {event_date}. New deadline: {new_expiry_date}.` |
| `private_booking_cancelled_hold` | `booking_cancelled_hold` | `Hi {firstName} — your hold on {event_date} is cancelled. No money changed hands. Shout if you'd like another date.` |
| `private_booking_cancelled_refundable` | `booking_cancelled_refundable` | `Hi {firstName} — your booking on {event_date} is cancelled. We'll refund £{refund_amount} within 10 working days and confirm once it's on the way.` |
| `private_booking_cancelled_non_refundable` | `booking_cancelled_non_refundable` | `Hi {firstName} — your booking on {event_date} is cancelled. The £{retained_amount} already paid is retained per our booking terms. We'll be in touch if anything else is outstanding.` |
| `private_booking_cancelled_manual_review` | `booking_cancelled_manual_review` | `Hi {firstName} — your booking on {event_date} is cancelled. A member of our team will be in touch shortly to confirm next steps on payment.` |
| `private_booking_expired` | `booking_expired` | `Hi {firstName} — your hold on {event_date} has lapsed. No worries — shout if you'd like to rebook.` |
| `private_booking_thank_you` | `booking_completed` | `Hi {firstName} — thanks for choosing The Anchor. Hope it was everything you wanted.` |
| `private_booking_review_request` | `review_request` (gated) | `Hi {firstName} — glad {event_date} went well. If you've got 30 seconds, a Google review would mean a lot: {review_link}` |

### 9. Cron changes

**Retire** (delete routes, remove from `vercel.json`):
- `/api/cron/post-event-followup` — superseded by `private-booking-monitor` Pass 5a/5b.
- `/api/cron/booking-balance-reminders` — superseded by new `private-booking-monitor` Pass 3 that handles 14/7/1 day reminders.

**Modify** `private-booking-monitor`:
- Pass 3 extended: in addition to `balance_reminder_14day`, now fires `balance_reminder_7day` and `balance_reminder_1day` with same eligibility pattern.
- Pass 5 split: Pass 5a sends manager outcome email; Pass 5b sends review SMS for `went_well` outcomes.
- All passes apply `isBookingDateTbd(booking) = false` filter via the shared helper.
- All passes use stable business idempotency key (`private_booking_send_idempotency` table) in addition to existing queue dedupe.

### 10. Message body construction

New helper module `src/lib/private-bookings/messages.ts` — **pure** boundary:

- Exports: 20 template functions, one per trigger, returning strings only.
- Accepts: raw booking fields (not pre-sanitised).
- Applies: `getSmartFirstName()`, control-character sanitisation, length capping.
- Does NOT: query DB, read feature flags, call APIs, apply dedupe logic, decide eligibility.

Tests: pure builder tests with snapshot fixtures + one caller test per send path.

### 11. Stable idempotency for cron-driven sends

Body-inclusive dedupe lock invalidates on copy deploy. Introduce `private_booking_send_idempotency` table keyed by `{booking_id}:{trigger_type}:{window_key}`:

- `deposit_reminder_7day` → window_key = `hold_expiry` ISO date
- `deposit_reminder_1day` → window_key = `hold_expiry` ISO date
- `balance_reminder_14/7/1_day` → window_key = `balance_due_date` or `event_date` ISO date
- `event_reminder_1d` → window_key = `event_date` ISO date
- `review_request` → window_key = `event_date` ISO date

Cron inserts the key into `private_booking_send_idempotency` BEFORE calling SmsQueueService. Unique constraint prevents duplicates. Existing body-inclusive dedupe stays as defense-in-depth.

Action-driven sends (`booking_created`, `deposit_received`, etc.) continue to use existing dedupe — they're not tied to a time window and already have idempotency guards where needed.

### 12. API route — outcome confirmation

**`GET /api/private-bookings/outcome/{outcome}/{token}`**: renders a minimal confirmation page:

```
Mark {customer_name}'s event on {event_date} as: {outcome}?

[Confirm] (button — submits POST)
[Cancel]
```

No state mutation. Safe for email prefetchers.

**`POST /api/private-bookings/outcome/{outcome}/{token}`**: performs the mutation per §2 flow. CSRF-protected via Next.js server-action mechanism.

### 13. Shared helpers

- `isBookingDateTbd(booking)` in `src/lib/private-bookings/tbd-detection.ts` — wraps the `internal_notes` check for `DATE_TBD_NOTE`. Called by cron passes and Communications tab.
- `getBookingScheduledSms(bookingId, now)` in `src/services/private-bookings/scheduled-sms.ts` — eligibility calc shared by cron and UI.
- `sanitiseSmsVariable(value: string, maxLen: number)` in `src/lib/sms/sanitise.ts` — strips control chars, collapses whitespace, caps length.

---

## Testing Strategy

### Unit tests (Vitest, mocked Supabase)
- `tests/lib/privateBookingsMessages.test.ts`: each template function — snapshot fixtures + edge cases (missing first name, control-char injection, amount formatting, London date formatting).
- `tests/services/privateBookingsFinancial.test.ts`: `getPrivateBookingPaidTotals` and `getPrivateBookingCancellationOutcome` — no_money / refundable / non_refundable_retained / manual_review paths.
- `tests/lib/privateBookingsTbdDetection.test.ts`: TBD detection with present/absent note text.
- `tests/services/privateBookingsScheduledSms.test.ts`: returns expected scheduled items + suppression reasons for flags/TBD/STOP.

### Integration tests
- `tests/api/privateBookingOutcomeRoute.test.ts`: GET renders confirmation (no state change); POST consumes token; concurrent POSTs with different outcomes → first wins, second renders "already recorded"; expired token → error page; scanner prefetch simulation (GET×3) leaves state unchanged.
- `tests/api/privateBookingMonitorPass5.test.ts`: Pass 5a sends email + creates tokens only when not already sent; Pass 5b sends review SMS only for `went_well`; cancelled booking suppresses 5b even if outcome is `went_well`.
- `tests/services/privateBookingsMutations.test.ts`: cancelBooking variant selection; deletePrivateBooking blocked by SMS-sent guard; DB trigger raises on direct delete.
- STOP opt-out test: mock customer opt-out; verify review SMS is suppressed.

### Manual test plan
- End-to-end happy path: draft → deposit → confirm → balance → event → thanks → manager email → "went well" → review SMS.
- Bad-path: manager picks "issues" → no review SMS ever fires.
- Email prefetch simulation: open outcome email in preview pane; verify no state change; click Confirm to mutate.
- Cancellation variants: trigger each outcome, verify correct SMS.
- Delete gate: attempt delete on booking with sent SMS — UI blocks; direct SQL delete — trigger raises.
- Date-TBD booking: no date-based reminders in Communications tab; `booking_created` SMS still shown in history.
- Copy-refresh deploy simulation: cron fires old body, deploy new body, cron runs again within 15 min — idempotency key prevents duplicate.

### Regression
- Existing action-driven SMS continue to send with refreshed copy.
- 15-min body dedupe lock still works as defense-in-depth.
- Quiet hours still defer night-time sends.
- Existing `private_feedback` token flow unchanged.

---

## Phasing

Each phase is independently deployable and touches a bounded set of files.

### Phase 1 — Infrastructure + legacy cron retirement (P1)
- Migrations: new columns on `private_bookings`, `guest_tokens` action extension, `private_booking_send_idempotency` table, delete-gate trigger.
- Retire `/api/cron/post-event-followup` and `/api/cron/booking-balance-reminders` (delete routes, remove from `vercel.json`).
- Add `isBookingDateTbd()` helper.
- Add `sanitiseSmsVariable()` helper.

### Phase 2 — Messages module + tone refresh (P0)
- New `src/lib/private-bookings/messages.ts` with all 20 template functions.
- Refactor every inline body in `mutations.ts`, `payments.ts`, and `private-booking-monitor/route.ts` to call the module.
- Extend Pass 3 with 7-day and 1-day balance reminders.
- Snapshot tests in same PR.
- Update `PrivateBookingMessagesClient.tsx` template suggestions.

### Phase 3 — Cancellation split + financial outcome (P0)
- `src/services/private-bookings/financial.ts` with outcome logic.
- `cancelBooking()` variant selection.
- Four new cancellation templates wired.
- Tests.

### Phase 4 — Post-event outcome gate (P0)
- `sendPrivateBookingOutcomeEmail()` in `manager-notifications.ts`.
- `/api/private-bookings/outcome/[outcome]/[token]` route (GET confirm + POST mutate).
- `private-booking-monitor` Pass 5 split into 5a/5b with atomic claims.
- Outcome token flow via `guest_tokens`.

### Phase 5 — Deletion gate (P1)
- `deletePrivateBooking()` server-side guard (trigger already in Phase 1).
- UI disable + tooltip logic.
- Confirmation modal extension.

### Phase 6 — Communications tab + preview modals (P1)
- `getBookingScheduledSms()` helper.
- New `CommunicationsTab.tsx`.
- Extend cancel/complete/delete modals with resolved-body preview.
- Accessibility pass.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Manager never clicks outcome email → no review asks sent | Medium | Low (safe default) | Weekly ops query for `post_event_outcome = 'pending'` older than 14 days |
| Scanner prefetch consumes tokens | N/A (mitigated by GET-confirm+POST-mutate) | N/A | Pattern ensures GET is read-only |
| Legacy cron removal breaks scheduled messages in flight | Low | Medium | Phase 1 retires routes AFTER Phase 2 moves copy into monitor; deploy in order |
| Dispute detection unreliable → customer gets `refundable` copy when retention was intended | Medium | Medium | `manual_review` is default fallback when detection uncertain; ops confirms refund amount before sending |
| Idempotency table grows unbounded | Low | Low | Scheduled cleanup cron, 90-day retention |
| DB trigger bypass by direct SQL access | Low | Low | Service-role access is gated; trigger is still the defence |
| Token table pollution (many outcome tokens generated) | Low | Low | Existing `guest_tokens` cleanup job handles expired rows |
| `getSmartFirstName` handles customer_first_name but not names elsewhere | Low | Low | All template functions accept raw fields and apply sanitiser + getSmartFirstName consistently |

---

## Decisions (approved 2026-04-18)

- [x] **A1**: Assume `PRIVATE_BOOKING_UPCOMING_EVENT_SMS_ENABLED` is `false` in production. Phase 4 is enablement pre-work. Implementation Task 4.0 verifies the actual Vercel env value as the first step of Phase 4 — if it's `true`, Phase 4 upgrades to P0 and ships ahead of Phase 2.
- [x] **A2**: Refund SLA is **10 working days** (verbatim in SMS copy).
- [x] **A3**: Outcome token lifetime is **14 days**.
- [x] **A4**: Retire `/api/cron/post-event-followup` and `/api/cron/booking-balance-reminders`. Their behaviour folds into `private-booking-monitor`.
- [x] **A5**: Deposit is **always non-refundable** on cancellation. Balance payments are refundable unless disputed. Selection: `total_paid = 0` → `no_money`; only deposit paid → `non_refundable_retained`; deposit + balance paid → `refundable` (refund = balance_payments_total); any dispute → `manual_review`.
- [x] **A6**: No manager-inbox escalation in v1. A weekly ops query surfaces bookings stuck at `post_event_outcome = 'pending'` for >14 days — if that list consistently exceeds 30% of eligible bookings, escalation is added in a follow-up.

---

## References

- Adversarial review artefacts: `tasks/codex-qa-review/2026-04-18-private-bookings-sms-redesign-*.md`
- `src/services/private-bookings/mutations.ts` — state-change SMS triggers
- `src/services/private-bookings/payments.ts` — payment-driven SMS triggers
- `src/app/api/cron/private-booking-monitor/route.ts` — all cron-driven SMS
- `src/services/sms-queue.ts` — auto-send trigger list + dedupe lock
- `src/lib/twilio.ts` — quiet-hours enforcement
- `src/lib/guest/tokens.ts` + `src/lib/guest/token-throttle.ts` — token patterns
- `src/lib/private-bookings/manager-notifications.ts` — existing manager email abstraction
- `src/lib/sms/name-utils.ts` — `getSmartFirstName`
- Prior spec: `docs/superpowers/specs/2026-03-22-event-sms-cross-promotion-and-tone-refresh.md` — voice reference
- Prior spec: `docs/superpowers/specs/2026-03-19-private-bookings-payment-history.md` — payment ledger baseline
