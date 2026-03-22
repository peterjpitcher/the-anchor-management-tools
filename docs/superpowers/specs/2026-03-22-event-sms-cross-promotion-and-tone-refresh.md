# Event SMS Cross-Promotion & Tone Refresh

**Date**: 2026-03-22
**Status**: Design approved
**Complexity**: L (4) — new inbound SMS parsing, cross-promotion engine, tone refresh across all SMS touchpoints

---

## Problem Statement

The Anchor sends multiple automated SMS messages across events, table bookings, Sunday preorders, private bookings, and parking — but:

1. **No cross-promotion**: Customers who attend quiz nights never hear about music bingo, and vice versa. There's no mechanism to drive bookings for upcoming events by targeting past attendees of similar events.
2. **Inconsistent tone**: SMS messages are functional and transactional, varying in personality across different touchpoints. They don't reflect The Anchor's brand personality.
3. **No reply-to-book**: Customers can't respond to a promotion SMS to book seats — they'd need to find the website or call.
4. **Review spam**: Customers who've already left a review still receive review request SMS.

## Success Criteria

- Past event attendees receive a promotional SMS 14 days before similar upcoming events
- Customers can reply with a number to auto-book seats for free/cash-on-door events
- Paid events include a short-link to the event page for booking
- All SMS across every touchpoint share a consistent, cheeky/playful brand voice
- Review requests are only sent to customers who haven't previously clicked a review link
- No disruption to existing SMS safety infrastructure (rate limits, quiet hours, idempotency, opt-in checks)

## Scope

### In scope
- Cross-promotion engine (targeting, sending, cron integration)
- Reply-to-book (inbound SMS parsing, booking creation)
- Tone refresh for ALL SMS: events, table bookings, Sunday preorder, private bookings, parking
- Review-once rule for review request SMS

### Out of scope
- Changes to SMS infrastructure (rate limits, quiet hours, safety guards)
- Changes to bulk SMS UI or admin messaging tools
- New event categories or booking flow changes
- Two-way conversational SMS beyond reply-to-book

---

## Design

### 1. Cross-Promotion Engine

#### Trigger
14 days before any event where `booking_open = true` and available capacity exists.

Runs as a new stage within the existing `event-guest-engagement` cron (`/api/cron/event-guest-engagement/route.ts`). The cron already has a lookahead window — extend it to 14 days for the promo stage.

#### Audience Selection

Reuses the existing bulk SMS category filter logic (same as `/messages/bulk` page):

1. Query `customer_category_stats` for customers who booked seats (not `is_reminder_only`) for the same event category as the upcoming event
2. Filter to `last_attended_date` within the last 6 months
3. Exclude customers who already have an active booking (`status` in `pending_payment`, `confirmed`) for this specific event
4. Require `marketing_sms_opt_in = true` (this is a promotional message, not transactional)
5. Require `sms_opt_in = true` and `sms_status` is null or `'active'`

#### Message Templates

**Free/cash-on-door event** (template key: `event_cross_promo_14d`):
```
The Anchor: {first_name}! Loved having you at {last_event_category} — {event_name} is coming up on {event_date}. Fancy it? Just reply with how many seats and you're sorted! Offer open for 48hrs.
```

**Paid event** (template key: `event_cross_promo_14d_paid`):
```
The Anchor: {first_name}! Loved having you at {last_event_category} — {event_name} is coming up on {event_date}. Fancy it? Grab your seats here: {event_link}
```

#### Determining Free vs Paid Events

Use the `is_free` field on the `events` table:
- `is_free = true` → free/cash-on-door event → reply-to-book template
- `is_free = false` → paid event → short-link template

#### Smart Variables

| Variable | Source |
|----------|--------|
| `{first_name}` | Customer first name (smart greeting fallback to "there" for placeholder names) |
| `{last_event_category}` | Event category name via join: `customer_category_stats.category_id` → `event_categories.name` (e.g., "Quiz Night", "Music Bingo") |
| `{event_name}` | Upcoming event name |
| `{event_date}` | Upcoming event date, formatted in London timezone |
| `{event_link}` | Short-link to the event page on the website (paid events only) |

#### Capacity Check

Uses the existing `get_event_capacity_snapshot_v05` RPC which returns `seats_remaining`.

- If `seats_remaining < 10` at send time for a free/cash event, skip the promo entirely (avoids promos we can't fulfil via reply-to-book)
- For paid events, send regardless of capacity (the event page will show availability)
- If event is fully booked (`seats_remaining = 0`), skip the promo for all payment types

#### Idempotency

Uses the existing `idempotency_keys` table mechanism. The idempotency key is composed of: template key (`event_cross_promo_14d` or `event_cross_promo_14d_paid`) + `customer_id` + `event_id`. One promo per customer per event, ever.

#### Promo Context Storage

The reply-to-book parser needs to look up which event a customer was promoted. Since the `messages` table has no `metadata` JSONB column, a new `sms_promo_context` table is required (see Database Changes section).

When a promo SMS is sent, insert a row into `sms_promo_context`:
```json
{
  "customer_id": "<customer_id>",
  "phone_number": "<e164_phone>",
  "event_id": "<event_id>",
  "template_key": "event_cross_promo_14d",
  "reply_window_expires_at": "<ISO timestamp 48hrs from send>",
  "message_id": "<messages table FK>"
}
```

The reply-to-book parser queries this table to match inbound replies to promo context.

---

### 2. Reply-to-Book (Inbound SMS Parsing)

#### Overview

Extends the existing Twilio webhook (`/api/webhooks/twilio/route.ts`) to parse inbound SMS replies and create event bookings automatically.

#### Flow

1. Inbound SMS arrives at webhook
2. Extract the sender's phone number
3. Attempt to parse a seat count from the message body (regex: first digit sequence, 1-10)
4. If no number found → fall through to existing inbound handling (staff message thread)
5. Look up `sms_promo_context` table for the most recent promo sent to this phone where `reply_window_expires_at > NOW()`
6. If no matching promo found → fall through to existing inbound handling
7. Extract `event_id` from the promo context row
8. Validate: event still exists, `booking_open = true`, sufficient capacity (via `get_event_capacity_snapshot_v05` RPC, checking `seats_remaining`)
9. Resolve customer from phone number (using the existing inline phone-variant lookup pattern from the Twilio webhook, extracted into a shared helper)
10. Create booking via a shared booking creation service extracted from `/api/event-bookings/route.ts` (the POST handler). This ensures the same validation, audit logging, and confirmation SMS flow applies to reply-to-book as to manual bookings.
11. The existing booking confirmation SMS fires automatically — no separate confirmation needed

#### Seat Count Parsing

Simple regex extraction: `/(\d+)/` — take the first digit sequence from the message body.

- "4" → 4 seats
- "4 please" → 4 seats
- " 4 " → 4 seats
- "yes 2" → 2 seats
- "book me 6 seats" → 6 seats (first number wins)

#### Edge Case Responses

All response SMS use template key `event_reply_booking_response` + appropriate suffix for idempotency.

| Scenario | SMS Response |
|----------|-------------|
| Number > 10 | "That's a big group! Give us a ring on {venue_phone} and we'll sort you out." |
| Number = 0 or no number found | No response — falls through to existing inbound message handling |
| No matching promo in 48hrs | No response — falls through to existing inbound message handling |
| Event sold out | "Gutted — {event_name} is fully booked! Keep an eye out for the next one." |
| Not enough seats remaining | "We've only got {remaining} seats left for {event_name}. Reply {remaining} or less and we'll get you in!" |
| Booking created | No response — existing booking confirmation flow handles it |
| Customer already has booking for this event | "Looks like you're already booked in for {event_name}! See you there." |

#### Safety

- All existing SMS safety guards apply to response messages (rate limits, idempotency)
- **Quiet hours exception for reply-to-book responses**: When a customer actively replies, they expect an immediate response. Reply-to-book edge case responses (sold out, too many seats, etc.) bypass quiet hours deferral. The booking confirmation SMS still respects quiet hours as it goes through the standard send path.
- Reply-to-book only works for free/cash-on-door events (`is_free = true`). Paid event promos don't include the reply mechanic.
- Maximum 10 seats per reply booking
- The booking is created through the shared booking creation service (extracted from `/api/event-bookings/route.ts`), so all validation, audit logging, and confirmation flows apply

#### Late Reply Handling

If a customer replies after 48 hours (no matching promo context found), their message falls through to the normal inbound handling — it appears in the staff message thread as a regular customer message. No "too late" response is sent, as the customer may not even be replying to a promo.

---

### 3. Review-Once Rule

#### Change

Before sending any review request SMS (event review, table review, private booking feedback), check whether the customer has ever clicked a review link for any past booking.

#### Implementation

Check both `bookings` and `table_bookings` tables for any record where:
- `customer_id` matches
- `review_clicked_at IS NOT NULL`

If any such record exists in either table, skip the review SMS for this customer entirely. A customer who reviewed via a table booking link shouldn't be asked again for an event booking, and vice versa.

This applies to all three review templates:
- `event_review_followup`
- `table_review_followup`
- `private_booking_feedback_followup`

---

### 4. Tone Refresh — Complete Message Catalogue

All SMS messages refreshed with a consistent cheeky/playful brand voice. Messages drop the formal "Hi {first_name}," opener in favour of the punchier "{first_name}!" pattern.

#### 4.1 Event Bookings

**Booking Confirmed** (template: `event_booking_confirmed`)
```
The Anchor: {first_name}! You're in — {seats} seat(s) locked in for {event_name} on {event_date}. See you there! {manage_link}
```

**Booking Pending Payment** (template: `event_booking_pending_payment`)
```
The Anchor: {first_name}! {seats} seat(s) held for {event_name} — nice one! We'll ping you a payment link shortly. {manage_link}
```

**1-Day Reminder** (template: `event_reminder_1d`)
```
The Anchor: {first_name}! {event_name} is tomorrow at {event_time} — don't be late! {manage_link}
```

**Post-Event Review** (template: `event_review_followup`) — subject to review-once rule
```
The Anchor: {first_name}! Hope you had a belter at {event_name} last night. Got 30 seconds? A quick review means the world to us: {review_link}
```

#### 4.2 Table Bookings

**Deposit Confirmed** (template: `table_booking_deposit_confirmed`)
```
The Anchor: {first_name}! Deposit sorted — your table for {party_size} on {booking_date} is locked in. See you then! {manage_link}
```

**Cancelled with Refund** (template: `table_booking_cancelled_refund`)
```
The Anchor: {first_name}, your booking on {date} has been cancelled. Your £{amount} refund will land within 5-10 days. Hope to see you again soon!
```

**Cancelled No Refund (within 3 days)** (template: `table_booking_cancelled_no_refund`)
```
The Anchor: {first_name}, your booking on {date} has been cancelled. As it's within 3 days, the deposit can't be refunded. Hope to see you another time!
```

**Cancelled No Deposit** (template: `table_booking_cancelled_no_deposit`)
```
The Anchor: {first_name}, your booking on {date} has been cancelled. Hope to see you again soon!
```

**Table Review** (template: `table_review_followup`) — subject to review-once rule
```
The Anchor: {first_name}! Thanks for popping in. Got 30 seconds? A quick review means the world to us: {review_link}
```

#### 4.3 Sunday Preorder

**48-Hour Reminder** (template: `sunday_preorder_reminder_48h`)
```
The Anchor: {first_name}! Your Sunday lunch is coming up — get your pre-order in so we can have everything ready for you: {preorder_link}
```

**26-Hour Final Reminder** (template: `sunday_preorder_reminder_26h`)
```
The Anchor: {first_name}! Last chance to get your Sunday lunch pre-order in — we need it by tonight or we'll have to release your table: {preorder_link}
```

**24-Hour Auto-Cancellation** (template: `sunday_preorder_cancelled_24h`)
```
The Anchor: {first_name}, we've had to release your Sunday lunch booking as the pre-order wasn't completed in time. No charge applied — hope to see you another week!
```

#### 4.4 Private Bookings

**Deposit Reminder — 7 Days** (template: `private_booking_deposit_reminder_7day`)
```
The Anchor: {first_name}! Your hold on {event_date} expires in {days} days — get your deposit in and the date's all yours: {payment_link}
```

**Deposit Reminder — 1 Day** (template: `private_booking_deposit_reminder_1day`)
```
The Anchor: {first_name}! Your hold on {event_date} expires tomorrow — we'd hate to lose you! Get your deposit in today: {payment_link}
```

**Balance Reminder — 14 Days** (template: `private_booking_balance_reminder_14day`)
```
The Anchor: {first_name}! Your event on {event_date} is getting close — just the £{amount} balance left to pay by {due_date}: {payment_link}
```

**Event Reminder — 1 Day** (template: `private_booking_event_reminder_1d`)
```
The Anchor: {first_name}! Tomorrow's the big day — everything's ready for your {guest_count} guests. Can't wait to see you!
```

**Hold Expired** (template: `private_booking_expired`)
```
The Anchor: {first_name}, your hold on {event_date} has been released. No worries — give us a shout if you'd like to rebook!
```

**Post-Event Feedback** (template: `private_booking_feedback_followup`) — subject to review-once rule
```
The Anchor: {first_name}! Hope your event was everything you wanted. Got 30 seconds? A quick review means the world to us: {review_link}
```

#### 4.5 Parking

**Payment Reminder — Week Before** (template: `parking_payment_reminder_7d`)
```
The Anchor: {first_name}! Just a nudge — your parking from {start_date} to {end_date} needs paying (£{amount}). Sort it here: {url}
```

**Payment Reminder — Day Before Expiry** (template: `parking_payment_reminder_1d`)
```
The Anchor: {first_name}! Your parking offer expires tomorrow — £{amount} for {start_date} to {end_date}. Last chance: {url}
```

**Session Starting — 3 Days** (template: `parking_session_start_3d`)
```
The Anchor: {first_name}! Your parking kicks off on {start_date} — just checking you've got {vehicle_reg} ready to go!
```

**Session Ending — 3 Days** (template: `parking_session_end_3d`)
```
The Anchor: {first_name}! Heads up — your parking wraps up on {end_date}. Need to extend? Give us a shout on {venue_phone}.
```

#### 4.6 Cross-Promotion (New)

**Free/Cash Event Promo** (template: `event_cross_promo_14d`)
```
The Anchor: {first_name}! Loved having you at {last_event_category} — {event_name} is coming up on {event_date}. Fancy it? Just reply with how many seats and you're sorted! Offer open for 48hrs.
```

**Paid Event Promo** (template: `event_cross_promo_14d_paid`)
```
The Anchor: {first_name}! Loved having you at {last_event_category} — {event_name} is coming up on {event_date}. Fancy it? Grab your seats here: {event_link}
```

#### 4.7 Reply-to-Book Responses (New)

**Too Many Seats** (template: `event_reply_too_many`)
```
That's a big group! Give us a ring on {venue_phone} and we'll sort you out.
```

**Event Sold Out** (template: `event_reply_sold_out`)
```
Gutted — {event_name} is fully booked! Keep an eye out for the next one.
```

**Not Enough Seats** (template: `event_reply_limited_seats`)
```
We've only got {remaining} seats left for {event_name}. Reply {remaining} or less and we'll get you in!
```

**Already Booked** (template: `event_reply_already_booked`)
```
Looks like you're already booked in for {event_name}! See you there.
```

---

### 5. Cron Changes

#### event-guest-engagement cron

Add a new stage to the existing cron pipeline:

| Stage | Timing | Audience | Action |
|-------|--------|----------|--------|
| **Cross-promotion** (NEW) | 14 days before event | Past category attendees (6mo) without booking | Send promo SMS |
| 1-day reminder (existing) | 1 day before event | Customers with active booking | Send reminder SMS |
| Post-event review (existing) | Morning after event | Customers who had booking | Send review SMS (review-once rule) |

The promo stage uses a separate lookahead constant `EVENT_PROMO_LOOKAHEAD_DAYS` (default 14), independent of the existing `EVENT_ENGAGEMENT_LOOKAHEAD_DAYS` (8 days) used for reminders. This avoids changing the reminder query window.

#### Send Guards

The promo stage uses its own send guard: `EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT` (default 120), separate from the existing `EVENT_ENGAGEMENT_HOURLY_SEND_GUARD_LIMIT`. This allows promos to be throttled independently from transactional event SMS.

#### Per-Customer Promo Frequency

To avoid over-messaging, a customer receives at most one cross-promotion SMS per 7-day period. If two events of the same category are both within the promo window, only the nearest event is promoted to each customer.

---

### 6. Database Changes

#### New table: `sms_promo_context`

Required because the `messages` table has no `metadata` JSONB column. This table stores the context needed to match inbound SMS replies to the promo that triggered them.

```sql
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

-- Index for reply-to-book lookup: find active promo by phone number
CREATE INDEX idx_sms_promo_context_reply_lookup
ON sms_promo_context (phone_number, reply_window_expires_at DESC)
WHERE booking_created = FALSE;

-- Cleanup: rows older than 30 days can be purged
```

#### Existing tables leveraged

- `customer_category_stats` — attendance tracking by category (join to `event_categories` for category name)
- `bookings` — `review_clicked_at` field for review-once rule
- `table_bookings` — `review_clicked_at` field for review-once rule (both tables checked)
- `idempotency_keys` — existing deduplication mechanism
- `messages` — outbound/inbound SMS logging (no schema changes needed)

---

### 7. Environment Variables

No new required env vars. Optional additions:

| Variable | Default | Purpose |
|----------|---------|---------|
| `EVENT_PROMO_LOOKAHEAD_DAYS` | `14` | How far ahead to look for events to promote |
| `EVENT_PROMO_RECENCY_MONTHS` | `6` | How recent customer attendance must be |
| `EVENT_PROMO_REPLY_WINDOW_HOURS` | `48` | Reply-to-book window duration |
| `EVENT_PROMO_MAX_SEATS` | `10` | Maximum seats per reply booking |
| `EVENT_PROMO_MIN_CAPACITY` | `10` | Minimum remaining capacity to send free event promos |

---

### 8. Webhook Changes

The Twilio inbound webhook (`/api/webhooks/twilio/route.ts`) gains a new code path:

1. **Before** existing inbound handling, check if the message is a reply-to-book
2. Parse seat count from body
3. If valid number + matching promo found → create booking, send edge-case response if needed
4. If not a reply-to-book → fall through to existing handling (message thread for staff)

This is additive — no existing webhook behaviour changes.

---

## Testing Strategy

### Unit Tests
- Seat count parser (various inputs: "4", "4 please", " 4 ", "yes 2", "book 6 seats", "0", "abc", "15")
- Audience selection logic (category matching, recency filtering, booking exclusion, opt-in checks)
- Reply window validation (within 48hrs, expired, no matching promo)
- Review-once check

### Integration Tests
- End-to-end reply-to-book flow (promo sent → reply received → booking created → confirmation sent)
- Cross-promotion cron stage (correct audience, correct message variant, idempotency)
- Edge cases: sold out, over capacity, already booked, too many seats

### Manual Testing
- Send a promo SMS to a test number
- Reply with a number and verify booking appears in admin
- Verify all refreshed message templates render correctly with smart variables
- Verify review-once rule prevents duplicate review requests

---

## Rollout Plan

1. **Phase 1**: Tone refresh — update all existing message templates. Low risk, immediately visible.
2. **Phase 2**: Review-once rule — add the check before review SMS. Low risk, reduces unnecessary messages.
3. **Phase 3**: Cross-promotion engine — new cron stage, audience selection, promo templates. Medium risk, new outbound messaging.
4. **Phase 4**: Reply-to-book — inbound SMS parsing, booking creation. Highest complexity, depends on Phase 3.

Each phase is independently deployable and testable.
