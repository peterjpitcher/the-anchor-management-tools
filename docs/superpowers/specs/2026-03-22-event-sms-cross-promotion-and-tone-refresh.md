# Event SMS Cross-Promotion & Tone Refresh

**Date**: 2026-03-22
**Status**: Design approved
**Complexity**: XL (5) — new inbound SMS parsing, cross-promotion engine, booking service extraction, tone refresh across all SMS touchpoints (hardcoded in server code, not centralised templates)

---

## Problem Statement

The Anchor sends multiple automated SMS messages across events, table bookings, Sunday preorders, private bookings, and parking — but:

1. **No cross-promotion**: Customers who attend quiz nights never hear about music bingo, and vice versa. There's no mechanism to drive bookings for upcoming events by targeting past attendees of similar events.
2. **Inconsistent tone**: SMS messages are functional and transactional, varying in personality across different touchpoints. They don't reflect The Anchor's brand personality.
3. **No reply-to-book**: Customers can't respond to a promotion SMS to book seats — they'd need to find the website or call.
4. **Review spam**: Customers who've already left a review still receive review request SMS.

## Success Criteria

- Past event bookers receive a promotional SMS 14 days before similar upcoming events
- Customers can reply with a number to auto-book seats for free/cash-on-door events
- Paid events include a short-link to the event page for booking
- All SMS across every touchpoint share a consistent, cheeky/playful brand voice
- Review requests are only sent to customers who haven't previously engaged with a review/feedback link
- No disruption to existing SMS safety infrastructure (rate limits, quiet hours, idempotency, opt-in checks)

## Scope

### In scope
- Cross-promotion engine (targeting, sending, cron integration)
- Reply-to-book (inbound SMS parsing, booking creation service extraction)
- Tone refresh for ALL SMS: events, table bookings, Sunday preorder, private bookings, parking
- Review-once rule for review request SMS

### Out of scope
- Changes to SMS infrastructure (rate limits, quiet hours, safety guards)
- Changes to bulk SMS UI or admin messaging tools
- New event categories or booking flow changes
- Two-way conversational SMS beyond reply-to-book

### Historical context

The `event-guest-engagement` cron previously contained marketing SMS logic that was intentionally removed (code comment: `reason: 'interest_marketing_removed'`). This spec reintroduces cross-promotion with a different approach: category-affinity targeting with opt-in gating (`marketing_sms_opt_in`), frequency caps, and reply-to-book — rather than the previous interest-based approach. The implementation should review the git history for the removal to understand any concerns that led to it.

### Implementation note: tone refresh scope

The tone refresh is materially larger than "update template records" because most live messages are **hardcoded in server code**, not centrally managed as editable templates. The following files contain inline message construction that must be modified directly:

| File | Messages |
|------|----------|
| `src/app/api/cron/event-guest-engagement/route.ts` | Event reminders, review followups |
| `src/app/api/event-bookings/route.ts` | Event booking confirmations |
| `src/app/api/foh/event-bookings/route.ts` | FOH event booking confirmations |
| `src/lib/table-bookings/bookings.ts` | Table deposit confirmation, cancellation, Sunday preorder request |
| `src/services/private-bookings.ts` | All private booking lifecycle messages (incl. `private_booking_final_payment`) |
| `src/app/api/cron/private-booking-monitor/route.ts` | Private booking reminders, expiry, feedback |
| `src/app/api/cron/sunday-preorder/route.ts` | Sunday preorder reminders, cancellation |
| `src/lib/parking/notifications.ts` | All parking notifications |
| `src/services/waitlist-offers.ts` | Waitlist offer SMS |
| `src/app/api/event-waitlist/[id]/accept/route.ts` | Waitlist acceptance confirmations |

This means the tone refresh requires modifying each of these files to update the inline message strings. There are no central template records to update.

---

## Design

### 1. Cross-Promotion Engine

#### Trigger
14 days before any event where `booking_open = true` and available capacity exists.

Runs as a new stage within the existing `event-guest-engagement` cron (`/api/cron/event-guest-engagement/route.ts`). The cron already has a lookahead window — the promo stage uses its own separate constant.

#### Audience Selection

A **dedicated query/RPC** is needed (not a copy of the `/messages/bulk` route, which is a UI-facing customer fetch with different filtering logic):

1. Query `customer_category_stats` for customers who have booked seats (not `is_reminder_only`) for the same event category as the upcoming event. Note: `customer_category_stats` tracks **bookings**, not check-ins. This is intentional — we want to target people who booked, regardless of whether they were marked as attended.
2. Filter to `last_attended_date` within the last 6 months
3. Exclude customers who already have an active booking (`status` in `pending_payment`, `confirmed`) for this specific event
4. Require `marketing_sms_opt_in = true` (this is a promotional message, not transactional)
5. Require `sms_opt_in = true` and `sms_status` is null or `'active'`
6. Exclude customers who received any cross-promo SMS in the last 7 days (per-customer frequency cap, checked via `sms_promo_context.created_at`)
7. If multiple events are in the promo window for the same category, only promote the nearest event to each customer

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

Use the `payment_mode` field on the `events` table (NOT `is_free` — `payment_mode` is what the booking API, FOH API, and event endpoints actually use):

- `payment_mode IN ('free', 'cash_only')` → reply-to-book template (no advance payment needed)
- `payment_mode = 'prepaid'` → short-link template (customer must pay online)

#### Smart Variables

| Variable | Source |
|----------|--------|
| `{first_name}` | Customer first name (smart greeting fallback to "there" for placeholder names) |
| `{last_event_category}` | Event category name via join: `customer_category_stats.category_id` → `event_categories.name` (e.g., "Quiz Night", "Music Bingo") |
| `{event_name}` | Upcoming event name |
| `{event_date}` | Upcoming event date, formatted in London timezone |
| `{event_link}` | Short-link to the event page, generated via the existing event marketing short-link system (`src/services/event-marketing.ts` — `getOrCreateEventShortLink()`). Do NOT create a one-off link implementation. |

#### Capacity Check

Uses the existing `get_event_capacity_snapshot_v05` RPC which returns `seats_remaining`.

- If `seats_remaining < 10` at send time for a free/cash event, skip the promo entirely (avoids promos we can't fulfil via reply-to-book)
- For paid events, send regardless of capacity (the event page will show availability)
- If event is fully booked (`seats_remaining = 0`), skip the promo for all payment types

#### Idempotency

Uses the existing `idempotency_keys` table mechanism. The idempotency key is composed of: template key (`event_cross_promo_14d` or `event_cross_promo_14d_paid`) + `customer_id` + `event_id`. One promo per customer per event, ever.

#### Promo Context Storage

The reply-to-book parser needs to look up which event a customer was promoted.

**Schema drift note**: The codebase contains code that reads/writes `messages.metadata`, but the generated DB types and production schema may not have this column. Before implementation, verify the actual production schema. If `messages.metadata` exists, promo context could be stored there. If not, use the `sms_promo_context` table (see Database Changes section).

The recommended approach is the dedicated `sms_promo_context` table regardless, as it provides cleaner indexing for reply lookups and doesn't depend on resolving the schema drift.

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

#### Booking Service Extraction

This is a **substantial refactoring task**, not a trivial extension. Event booking creation is currently duplicated across:
- `/api/event-bookings/route.ts` (public API — `p_source = 'brand_site'`)
- `/api/foh/event-bookings/route.ts` (FOH API — `p_source = 'foh'`)

Both inline request validation, auth wrapping, and the `create_event_booking_v05` RPC call. A shared `EventBookingService.createBooking()` function must be extracted that:
- Takes an explicit `source` parameter (`'brand_site'`, `'foh'`, `'sms_reply'`)
- Passes it through to the RPC as `p_source`
- Can be called from the public route, FOH route, and Twilio webhook
- Prevents FOH from drifting independently

This extraction is its own implementation task and should be completed and tested before the reply-to-book webhook work begins.

#### Flow

1. Inbound SMS arrives at webhook
2. Extract the sender's phone number
3. Attempt to parse a seat count from the message body (regex: first digit sequence, 1-10)
4. If no number found → fall through to existing inbound handling (staff message thread)
5. Look up `sms_promo_context` table for the most recent promo sent to this phone where `reply_window_expires_at > NOW()`
6. If no matching promo found → fall through to existing inbound handling
7. Extract `event_id` from the promo context row
8. Validate: event still exists, `booking_open = true`, sufficient capacity (via `get_event_capacity_snapshot_v05` RPC, checking `seats_remaining`)
9. Resolve customer from phone number using the existing customer-resolution logic in `src/lib/sms/customers.ts` (already centralised — do NOT create a second extraction)
10. Create booking via the new `EventBookingService.createBooking()` shared service. This ensures the same validation, audit logging, and confirmation SMS flow applies to reply-to-book as to manual bookings.
11. Mark the `sms_promo_context` row as `booking_created = true` to prevent duplicate bookings from repeated replies
12. The existing booking confirmation SMS fires automatically — no separate confirmation needed

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
| Promo already replied to (booking_created = true) | "Looks like you're already booked in for {event_name}! See you there." |

#### Safety

- All existing SMS safety guards apply to response messages (rate limits, idempotency)
- **Quiet hours exception for reply-to-book responses**: When a customer actively replies, they expect an immediate response. Reply-to-book edge case responses (sold out, too many seats, etc.) bypass quiet hours deferral. The booking confirmation SMS still respects quiet hours as it goes through the standard send path.
- Reply-to-book only works for free/cash-on-door events (`payment_mode IN ('free', 'cash_only')`). Paid event promos don't include the reply mechanic.
- Maximum 10 seats per reply booking
- The booking is created through the shared `EventBookingService.createBooking()`, so all validation, audit logging, and confirmation flows apply

#### Concurrency Handling

Two rapid replies from the same customer (different Twilio MessageSids) could race past the `sms_promo_context.booking_created` check. The primary backstop is the **active-booking unique index** on the `bookings` table (enforced by `create_event_booking_v05`). If the RPC raises a unique constraint violation, catch it and return the "already booked" response. The flow is:

1. Check `sms_promo_context.booking_created` — fast path, avoids RPC call
2. If false, attempt `EventBookingService.createBooking()`
3. If unique constraint violation → respond with "already booked" message
4. If success → set `booking_created = true` on the promo context row

This makes the system safe under concurrency without requiring distributed locks.

#### Late Reply Handling

If a customer replies after 48 hours (no matching promo context found), their message falls through to the normal inbound handling — it appears in the staff message thread as a regular customer message. No "too late" response is sent, as the customer may not even be replying to a promo.

---

### 3. Review-Once Rule

#### Change

Before sending any review request SMS, check whether the customer has previously engaged with a review link. Additionally, when review-once suppresses a send, persist a flag so the cron doesn't re-evaluate the same booking on every run.

#### Private booking consolidation

The app currently has two post-event private SMS flows:
- `private_booking_post_event_followup` — asks for a Google review
- `private_booking_feedback_followup` — asks for private feedback via a separate token flow

**Decision**: Consolidate to one flow — `private_booking_post_event_followup` (Google review only). The `private_booking_feedback_followup` flow is retired. If detailed private feedback is needed, that's a personal conversation, not an automated SMS.

#### Implementation

Check across two sources:

1. `bookings` table: any record where `customer_id` matches AND `review_clicked_at IS NOT NULL`
2. `table_bookings` table: any record where `customer_id` matches AND `review_clicked_at IS NOT NULL`

If any engagement is found in either table, skip the review SMS for this customer entirely.

#### Suppression persistence

**Problem**: The event/table review crons only transition bookings out of the "eligible for review" pool when a review SMS is actually sent. If review-once suppresses the send, the booking stays eligible and will be re-evaluated on every cron run — wasting queries and risking future logic drift.

**Solution**: When review-once suppresses a send, mark the booking with `review_sms_sent_at = NOW()` (or equivalent lifecycle flag) even though no SMS was sent. This moves the booking out of the eligible pool permanently. The field semantics shift from "SMS was sent" to "review stage was processed" — this is acceptable because the field's purpose is lifecycle progression, not delivery tracking.

For the private-booking follow-up pass: the existing dedup is based on previously sent `private_booking_post_event_followup` messages. When review-once suppresses, insert a synthetic message record (direction = 'outbound', status = 'suppressed', template_key = 'private_booking_post_event_followup') so the dedup mechanism recognises this booking as processed. Alternatively, add a `review_processed_at` field to `private_bookings`.

This applies to all review templates:
- `event_review_followup`
- `table_review_followup`
- `private_booking_post_event_followup` (consolidated — replaces both previous private follow-up flows)

---

### 4. Tone Refresh — Complete Message Catalogue

All SMS messages refreshed with a consistent cheeky/playful brand voice. Messages drop the formal "Hi {first_name}," opener in favour of the punchier "{first_name}!" pattern.

**Template key strategy**: Where the spec lists a template key, this is the `template_key` value used in the `sendSMS()` call metadata and idempotency system. Existing template keys are **preserved** (only the message copy changes, not the key). New template keys are only introduced for genuinely new message types. This preserves send-guard history, idempotency continuity, and reporting consistency.

#### 4.1 Event Bookings

**Booking Confirmed** (existing key: preserved from current code)
```
The Anchor: {first_name}! You're in — {seats} seat(s) locked in for {event_name} on {event_date}. See you there! {manage_link}
```

**Booking Pending Payment** (existing key: preserved from current code)
```
The Anchor: {first_name}! {seats} seat(s) held for {event_name} — nice one! We'll ping you a payment link shortly. {manage_link}
```

**1-Day Reminder** (existing key: `event_reminder_1d`)
```
The Anchor: {first_name}! {event_name} is tomorrow at {event_time} — don't be late! {manage_link}
```

**Post-Event Review** (existing key: `event_review_followup`) — subject to review-once rule
```
The Anchor: {first_name}! Hope you had a belter at {event_name} last night. Got 30 seconds? A quick review means the world to us: {review_link}
```

#### 4.2 Table Bookings

**Deposit Confirmed** (existing key: `table_booking_deposit_confirmed`)
```
The Anchor: {first_name}! Deposit sorted — your table for {party_size} on {booking_date} is locked in. See you then! {manage_link}
```

**Cancelled** (existing key: `table_booking_cancelled` — kept as ONE key)

The current implementation uses a single `table_booking_cancelled` template key and builds copy inline based on refund state. The tone refresh updates the inline copy but preserves the single-key approach. This avoids breaking send history, idempotency, and reporting continuity.

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

**Table Review** (existing key: `table_review_followup`) — subject to review-once rule
```
The Anchor: {first_name}! Thanks for popping in. Got 30 seconds? A quick review means the world to us: {review_link}
```

#### 4.3 Sunday Preorder

**48-Hour Reminder** (existing key: `sunday_preorder_reminder_48h`)
```
The Anchor: {first_name}! Your Sunday lunch is coming up — get your pre-order in so we can have everything ready for you: {preorder_link}
```

**26-Hour Final Reminder** (existing key: `sunday_preorder_reminder_26h`)
```
The Anchor: {first_name}! Last chance to get your Sunday lunch pre-order in — we need it by tonight or we'll have to release your table: {preorder_link}
```

**24-Hour Auto-Cancellation** (existing key: `sunday_preorder_cancelled_24h`)
```
The Anchor: {first_name}, we've had to release your Sunday lunch booking as the pre-order wasn't completed in time. No charge applied — hope to see you another week!
```

**Sunday Preorder Request** (existing key: `sunday_preorder_request`)
```
The Anchor: {first_name}! Time to pick what you're having for Sunday lunch — get your pre-order in here: {preorder_link}
```

#### 4.4 Private Bookings — Complete Catalogue

The following covers ALL live private booking SMS flows (not just the subset originally listed):

**Booking Created** (existing key: `private_booking_created`)
```
The Anchor: {first_name}! Your private booking for {event_date} is in — we're excited to host you! We'll be in touch with next steps. {manage_link}
```

**Deposit Received** (existing key: `private_booking_deposit_received`)
```
The Anchor: {first_name}! Deposit received — your date on {event_date} is locked in. We'll be in touch closer to the time! {manage_link}
```

**Booking Confirmed** (existing key: `private_booking_confirmed`)
```
The Anchor: {first_name}! Everything's confirmed for your event on {event_date}. We can't wait! {manage_link}
```

**Date Changed** (existing key: `private_booking_date_changed`)
```
The Anchor: {first_name}! Your booking has been moved to {new_event_date}. All sorted on our end! {manage_link}
```

**Hold Extended** (existing key: `private_booking_hold_extended`)
```
The Anchor: {first_name}! Good news — we've extended your hold on {event_date}. New deadline: {new_expiry_date}. {manage_link}
```

**Deposit Reminder — 7 Days** (existing key: `private_booking_deposit_reminder_7day`)
```
The Anchor: {first_name}! Your hold on {event_date} expires in {days} days — get your deposit in and the date's all yours: {payment_link}
```

**Deposit Reminder — 1 Day** (existing key: `private_booking_deposit_reminder_1day`)
```
The Anchor: {first_name}! Your hold on {event_date} expires tomorrow — we'd hate to lose you! Get your deposit in today: {payment_link}
```

**Balance Reminder — 14 Days** (existing key: `private_booking_balance_reminder_14day`)
```
The Anchor: {first_name}! Your event on {event_date} is getting close — just the £{amount} balance left to pay by {due_date}: {payment_link}
```

**Setup Reminder** (existing key: `private_booking_setup_reminder`)
```
The Anchor: {first_name}! Your event on {event_date} is nearly here — just a reminder to get any final details to us so we can make it perfect!
```

**Event Reminder — 1 Day** (existing key: `private_booking_event_reminder_1d`)
```
The Anchor: {first_name}! Tomorrow's the big day — everything's ready for your {guest_count} guests. Can't wait to see you!
```

**Hold Expired** (existing key: `private_booking_expired`)
```
The Anchor: {first_name}, your hold on {event_date} has been released. No worries — give us a shout if you'd like to rebook!
```

**Booking Cancelled** (existing key: `private_booking_cancelled`)
```
The Anchor: {first_name}, your booking on {event_date} has been cancelled. Hope to see you for something else soon!
```

**Thank You** (existing key: `private_booking_thank_you`)
```
The Anchor: {first_name}! Thanks so much for choosing The Anchor for your event — hope it was everything you wanted!
```

**Final Payment Received** (existing key: `private_booking_final_payment`)
```
The Anchor: {first_name}! Final payment received — you're all set for {event_date}. We'll be in touch with final details! {manage_link}
```

**Post-Event Review** (existing key: `private_booking_post_event_followup`) — subject to review-once rule. Consolidates the previous `private_booking_feedback_followup` flow (retired).
```
The Anchor: {first_name}! Hope your event was everything you wanted. Got 30 seconds? A quick review means the world to us: {review_link}
```

#### 4.5 Parking

Template keys are preserved to match the **live keys** used in `src/lib/parking/notifications.ts`:

**Payment Reminder — Week Before** (existing key: `parking_payment_reminder_week_before_expiry`)
```
The Anchor: {first_name}! Just a nudge — your parking from {start_date} to {end_date} needs paying (£{amount}). Sort it here: {url}
```

**Payment Reminder — Day Before Expiry** (existing key: `parking_payment_reminder_day_before_expiry`)
```
The Anchor: {first_name}! Your parking offer expires tomorrow — £{amount} for {start_date} to {end_date}. Last chance: {url}
```

**Session Starting — 3 Days** (existing key: preserved from current code)
```
The Anchor: {first_name}! Your parking kicks off on {start_date} — just checking you've got {vehicle_reg} ready to go!
```

**Session Ending — 3 Days** (existing key: preserved from current code)
```
The Anchor: {first_name}! Heads up — your parking wraps up on {end_date}. Need to extend? Give us a shout on {venue_phone}.
```

#### 4.6 Event Waitlist

**Waitlist Offer** (existing key: preserved from `src/services/waitlist-offers.ts`)
```
The Anchor: {first_name}! A spot just opened up for {event_name} on {event_date}. Want it? Grab your seat here before it's gone: {offer_link}
```

**Waitlist Accepted — Free/Cash Event** (existing key: preserved from waitlist acceptance route)
```
The Anchor: {first_name}! You're in — {seats} seat(s) confirmed for {event_name} on {event_date}. See you there! {manage_link}
```

**Waitlist Accepted — Prepaid Event** (existing key: preserved from waitlist acceptance route)
```
The Anchor: {first_name}! {seats} seat(s) held for {event_name} — nice one! Complete your payment here: {payment_link}. {manage_link}
```

#### 4.7 Cross-Promotion (New)

**Free/Cash Event Promo** (new key: `event_cross_promo_14d`)
```
The Anchor: {first_name}! Loved having you at {last_event_category} — {event_name} is coming up on {event_date}. Fancy it? Just reply with how many seats and you're sorted! Offer open for 48hrs.
```

**Paid Event Promo** (new key: `event_cross_promo_14d_paid`)
```
The Anchor: {first_name}! Loved having you at {last_event_category} — {event_name} is coming up on {event_date}. Fancy it? Grab your seats here: {event_link}
```

#### 4.8 Reply-to-Book Responses (New)

**Too Many Seats** (new key: `event_reply_too_many`)
```
That's a big group! Give us a ring on {venue_phone} and we'll sort you out.
```

**Event Sold Out** (new key: `event_reply_sold_out`)
```
Gutted — {event_name} is fully booked! Keep an eye out for the next one.
```

**Not Enough Seats** (new key: `event_reply_limited_seats`)
```
We've only got {remaining} seats left for {event_name}. Reply {remaining} or less and we'll get you in!
```

**Already Booked** (new key: `event_reply_already_booked`)
```
Looks like you're already booked in for {event_name}! See you there.
```

---

### 5. Cron Changes

#### event-guest-engagement cron

Add a new stage to the existing cron pipeline:

| Stage | Timing | Audience | Action |
|-------|--------|----------|--------|
| **Cross-promotion** (NEW) | 14 days before event | Past category bookers (6mo) without booking | Send promo SMS |
| 1-day reminder (existing) | 1 day before event | Customers with active booking | Send reminder SMS |
| Post-event review (existing) | Morning after event | Customers who had booking | Send review SMS (review-once rule) |

The promo stage uses a separate lookahead constant `EVENT_PROMO_LOOKAHEAD_DAYS` (default 14), independent of the existing `EVENT_ENGAGEMENT_LOOKAHEAD_DAYS` (8 days) used for reminders. This avoids changing the reminder query window.

#### Send Guards

The promo stage uses its own send guard: `EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT` (default 120), separate from the existing `EVENT_ENGAGEMENT_HOURLY_SEND_GUARD_LIMIT`. This allows promos to be throttled independently from transactional event SMS.

#### Per-Customer Promo Frequency

To avoid over-messaging, a customer receives at most one cross-promotion SMS per 7-day period (checked via `sms_promo_context.created_at`). If two events of the same category are both within the promo window, only the nearest event is promoted to each customer.

---

### 6. Database Changes

#### New table: `sms_promo_context`

Stores the context needed to match inbound SMS replies to the promo that triggered them, and enforces the 7-day per-customer frequency cap.

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

-- Index for frequency cap: recent promos per customer
CREATE INDEX idx_sms_promo_context_frequency
ON sms_promo_context (customer_id, created_at DESC);

-- Cleanup: rows older than 30 days can be purged
```

#### Pre-implementation investigation: `messages.metadata`

The codebase contains code that reads/writes `messages.metadata`, but the generated DB types may not reflect the actual production schema. Before implementation, run `SELECT column_name FROM information_schema.columns WHERE table_name = 'messages'` against production to determine whether `metadata` exists. This determines whether `sms_promo_context` is the only option or whether `messages.metadata` could also be used. The spec recommends `sms_promo_context` regardless for cleaner separation.

#### Existing tables leveraged

- `customer_category_stats` — booking tracking by category (join to `event_categories` for category name)
- `bookings` — `review_clicked_at` field for review-once rule
- `table_bookings` — `review_clicked_at` field for review-once rule
- `idempotency_keys` — existing deduplication mechanism
- `messages` — outbound/inbound SMS logging (no schema changes needed)

---

### 7. Environment Variables

No new required env vars. Optional additions:

| Variable | Default | Purpose |
|----------|---------|---------|
| `EVENT_PROMO_LOOKAHEAD_DAYS` | `14` | How far ahead to look for events to promote |
| `EVENT_PROMO_RECENCY_MONTHS` | `6` | How recent customer booking must be |
| `EVENT_PROMO_REPLY_WINDOW_HOURS` | `48` | Reply-to-book window duration |
| `EVENT_PROMO_MAX_SEATS` | `10` | Maximum seats per reply booking |
| `EVENT_PROMO_MIN_CAPACITY` | `10` | Minimum remaining capacity to send free event promos |
| `EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT` | `120` | Hourly send limit for promo SMS |
| `EVENT_PROMO_FREQUENCY_CAP_DAYS` | `7` | Minimum days between promos per customer |

---

### 8. Webhook Changes

The Twilio inbound webhook (`/api/webhooks/twilio/route.ts`) gains a new code path:

1. **Before** existing inbound handling, check if the message is a reply-to-book
2. Parse seat count from body
3. If valid number + matching promo found → create booking via `EventBookingService.createBooking()`, send edge-case response if needed
4. If not a reply-to-book → fall through to existing handling (message thread for staff)

This is additive — no existing webhook behaviour changes.

---

## Testing Strategy

### Unit Tests
- Seat count parser (various inputs: "4", "4 please", " 4 ", "yes 2", "book 6 seats", "0", "abc", "15")
- Audience selection query (category matching, recency filtering, booking exclusion, opt-in checks, frequency cap)
- Reply window validation (within 48hrs, expired, no matching promo, already replied)
- Review-once check (across bookings, table_bookings, and private booking feedback)
- `payment_mode` classification (`free`, `cash_only` → reply-to-book; `prepaid` → link)
- EventBookingService.createBooking() — extracted service works identically to API route

### Integration Tests
- End-to-end reply-to-book flow (promo sent → reply received → booking created → confirmation sent)
- Cross-promotion cron stage (correct audience, correct message variant, idempotency, frequency cap)
- Edge cases: sold out, over capacity, already booked, too many seats, duplicate reply

### Manual Testing
- Send a promo SMS to a test number
- Reply with a number and verify booking appears in admin
- Verify all refreshed message templates render correctly with smart variables
- Verify review-once rule prevents duplicate review requests
- Verify frequency cap prevents over-messaging

---

## Rollout Plan

1. **Phase 1**: Tone refresh — update all hardcoded message strings across server code. Low risk, immediately visible. Largest phase by file count.
2. **Phase 2**: Review-once rule — add the check before review SMS (across bookings, table_bookings, and private booking feedback). Low risk, reduces unnecessary messages.
3. **Phase 3**: Booking service extraction — extract `EventBookingService.createBooking()` from the event-bookings route. Medium risk, prerequisite for Phase 4.
4. **Phase 4**: Cross-promotion engine — new cron stage, audience selection query, promo templates, `sms_promo_context` table. Medium risk, new outbound messaging.
5. **Phase 5**: Reply-to-book — inbound SMS parsing, webhook extension, booking creation via extracted service. Highest complexity, depends on Phases 3 and 4.

Each phase is independently deployable and testable.

---

## Resolved Design Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| `is_free` vs `payment_mode`? | `payment_mode` | `payment_mode` is what the booking API actually uses; `is_free` is a derived/display field |
| Target booked or checked-in customers? | Booked | `customer_category_stats` tracks bookings; using check-ins would miss customers who booked but weren't explicitly checked in |
| What counts as "already reviewed" for private bookings? | N/A — consolidated to Google review only | `private_booking_feedback_followup` retired; only `private_booking_post_event_followup` (Google review) remains |
| One or two private post-event flows? | One — `private_booking_post_event_followup` only | `private_booking_feedback_followup` retired. Private feedback is a personal conversation, not automated SMS |
| Preserve or replace template keys? | Preserve existing, new keys only for new messages | Maintains send-guard history, idempotency continuity, and reporting |
| One or three table cancellation keys? | One (existing `table_booking_cancelled`) | Splitting keys is a reporting/idempotency breaking change, not just a text refresh |
| Extract customer resolution helper? | No — reuse existing `src/lib/sms/customers.ts` | Already centralised, creating a second extraction adds confusion |
| Booking service extraction scope? | Include public route, FOH route, and SMS reply | All three share `create_event_booking_v05`; extracting only two leaves FOH drifting |
| How to handle review-once suppression in cron lifecycle? | Persist `review_sms_sent_at` even when suppressed | Prevents re-evaluation on every cron run; semantics shift from "sent" to "processed" |
| Waitlist SMS in tone refresh? | Yes — included | Spec says "ALL SMS"; waitlist offer and acceptance are customer-facing event messages |
| Event short-link for paid promos? | Reuse existing `getOrCreateEventShortLink()` | Event marketing short-link system already exists; no one-off implementation |
| Reply-to-book concurrency? | Catch unique constraint from booking RPC | `sms_promo_context.booking_created` is fast-path; unique index on bookings is the real backstop |
