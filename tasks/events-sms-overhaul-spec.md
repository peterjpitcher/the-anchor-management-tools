# Event booking SMS overhaul: implementation spec

Status: proposed, nothing applied. Read-only analysis against prod (tfcasgxopxegwrabvwat) on 2026-07-23.
Branch to implement on: new branch off `main`. Do not implement on `feat/christmas-2026-booking-rules`.

---

## 1. Owner summary: what happens today

Event booking invites come from one background job that runs every 15 minutes. For any single event
the whole invite campaign is two text messages, and that is all.

| Who gets a text | When | How many, per event | What it says |
|---|---|---|---|
| People who came to this same kind of event in the last 90 days | Exactly 7 days before, arriving 9am | 3 to 12 in practice, 30 maximum | "Loved having you at Quiz, Quiz Night is coming up on Wednesday, 22 July 2026. Reply with seats." |
| People who came to any event in the last 42 days but not this kind | Exactly 7 days before, arriving 9am | included in the same 3 to 12 | "Music Bingo is coming up on Friday, 17 July 2026. Reply with seats." |
| Only the people who got the 7-day text and have not booked | The day before, arriving 9am | 0 to 12 | "Music Bingo is tomorrow. Reply with seats." |
| Everyone already booked | 24 hours before the start time | all of them | "Music Bingo is tomorrow at Fri 14 Aug, 7:00 pm, don't be late!" |

Nothing goes out between day 7 and day 1. Nothing goes out earlier than day 7. Every promo lands at
9am because the job picks the audience just after midnight and the quiet hours rule holds the text
until 9am.

### Why nobody got a Quiz Night invite on 22 July

Thirteen people qualified. Ten were blocked by a single rule: anyone texted about **any** event in the
last 7 days is blocked from **all** events. Those ten had been texted about Music Bingo five days
earlier. Since the pub runs two events most weeks, this rule mathematically guarantees that one of
them gets silenced.

### What is broken beyond that

1. **18 of the next 20 events are still drafts.** Draft events send nothing. On today's data the
   pipeline sends zero invites for anything after 14 August.
2. **Four Music Bingo dates have no category set.** Even once published they would send nothing.
3. **The audience windows are too tight.** Only 10 consented customers attended an event in the last
   42 days. At 180 days it is 25, and 35 once we count bookings marked "completed" as attendance
   (63 real attendances are currently discarded because the booking status was later changed).
4. **The invite only fires on one exact calendar day.** One missed job run, or publishing an event
   six days out instead of seven, and that event never gets invited at all, ever.
5. **The copy never says the time and never says the price**, and the "reply with seats" ask does not
   tell anyone what to send. A guest replying "two please" books nothing and gets silence.
6. **The reply reader only understands digits.** "Cancel my 4 please" currently books 4 seats.
7. **Every promo text contains a long dash**, which is not in the basic SMS character set, so each one
   is billed as 3 messages instead of 1.

### What changes

| Change | Effect |
|---|---|
| Widen the audience to 6 months and count completed bookings | Reachable pool per event goes from 10 to 35 |
| Stop one event's text blocking every other event | Recovers the 10 people who missed Quiz Night |
| Send across a catch-up window, not one exact day | A late-published event still gets its invite |
| New copy: date, time, price, and "text a number back, like 4" | Removes the two biggest reasons people do not reply |
| Teach the reply reader words, times and refusals | "Two seats please" books; "can't make it" does not |
| Remove the long dash | SMS cost on this path falls by roughly two thirds |
| Publish the draft events and set the missing categories | Without this, none of the above sends anything |

**Expected result per event: from 3 to 12 invites today, to 28 to 35 invites.** That is the honest
ceiling. Only 353 of 967 customers have consented to marketing texts at all, and only 35 of those
have attended an event in the last six months. Growing beyond 35 needs consent captured at the point
of booking, which is a separate piece of work.

---

## 2. Final copy set

Verified with a GSM 03.38 checker (basic plus extension tables). Every rendering below is GSM-7 and
one segment, at typical values **and** at the worst case in the live database (11 character first
name "Christopher", 32 character event name "Only Fools and Horses Quiz Night", 7:30pm start).
No curly apostrophes, no en dash, no em dash, no emoji.

Counts for the four promo templates **include** the 23 character suffix ` Reply STOP to opt out.`
that `withPromoOptOut` (src/lib/sms/cross-promo.ts:43) appends. The literal in code must omit it.

### 2.1 The length ladder (implement this first)

Event names in prod reach 32 characters and there is no rule stopping a longer one. A fixed string
would silently become two segments. Every builder therefore assembles a ladder of rungs and returns
the first rung that fits the budget. Budget is 160 septets for transactional messages and 137
septets for promo messages (160 minus the 23 character opt-out suffix).

```ts
// src/lib/sms/gsm7.ts (new)
export function gsm7Septets(text: string): number | null   // null when not GSM-7
export function smsSegments(text: string): number
export function fitToOneSegment(rungs: string[], budget: number): string
```

`fitToOneSegment` returns the first rung whose septet count is non-null and within budget, and the
last rung as a final fallback. Unit test asserts every rung set has a final rung that fits at a
40 character event name.

### 2.2 Promo templates

**`event_cross_promo_7d` and `event_general_promo_7d` (free and cash-on-door)**

Both keys now render the **same body**. The "Loved having you at {category}" opener is deleted: at
this venue the last category is nearly always the same as the promoted event, so it read as a glitch
in 16 of 16 live sends. Keep the two separate template keys so reporting can still tell the pools
apart.

Rung 1 (used at typical values):
```
The Anchor: {first_name}, {event_name} is on {event_date}, {event_time}. {cost} Bring who you like. How many seats? Text a number back, like 4.
```
Rung 2 (drop "Bring who you like."):
```
The Anchor: {first_name}, {event_name} is on {event_date}, {event_time}. {cost}How many seats? Text a number back, like 4.
```
Rung 3 (drop the cost and "on"):
```
The Anchor: {first_name}, {event_name} is {event_date}, {event_time}. How many seats? Text a number back, like 4.
```
Rung 4 (drop the first name):
```
The Anchor: {event_name} is {event_date}, {event_time}. How many seats? Text a number back, like 4.
```

Rendered and verified:
- cash, typical: `The Anchor: Margaret, Music Bingo is on Fri 14 Aug, 7pm. £5 on the door. Bring who you like. How many seats? Text a number back, like 4. Reply STOP to opt out.` **159 chars, 159 septets, 1 segment**
- free, typical: `The Anchor: Margaret, Quiz Night is on Fri 14 Aug, 7pm. Free entry. Bring who you like. How many seats? Text a number back, like 4. Reply STOP to opt out.` **154 chars, 1 segment**
- worst case (falls to rung 3): `The Anchor: Christopher, Only Fools and Horses Quiz Night is Sat 31 Oct, 7:30pm. How many seats? Text a number back, like 4. Reply STOP to opt out.` **147 chars, 1 segment**

**`event_reminder_promo_24h` (free and cash-on-door)**

```
The Anchor: {first_name}, {event_name} is tomorrow, {event_time}. {cost} Bring who you like. How many seats? Text a number back, like 4.
```
Rungs 2 to 4 drop "Bring who you like.", then the cost, then the first name, same as above.

- cash, typical: `The Anchor: Margaret, Music Bingo is tomorrow, 7pm. £5 on the door. Bring who you like. How many seats? Text a number back, like 4. Reply STOP to opt out.` **154 chars, 1 segment**
- free, typical: `The Anchor: Margaret, Quiz Night is tomorrow, 7pm. Free entry. Bring who you like. How many seats? Text a number back, like 4. Reply STOP to opt out.` **149 chars, 1 segment**
- worst case (rung 3): `The Anchor: Christopher, Only Fools and Horses Quiz Night is tomorrow, 7:30pm. How many seats? Text a number back, like 4. Reply STOP to opt out.` **145 chars, 1 segment**

**`event_cross_promo_7d_paid` and `event_general_promo_7d_paid` (prepaid only)**

```
The Anchor: {first_name}, {event_name} is on {event_date}, {event_time}. {cost} Bring who you like. Book your seats here: {link}
```
Rung 2 drops "Bring who you like.", rung 3 drops the cost and shortens to "Book seats here:", rung 4
drops the first name.

- typical: `The Anchor: Margaret, Music Bingo is on Fri 14 Aug, 7pm. £20 a head. Book your seats here: https://l.the-anchor.pub/ab12cd Reply STOP to opt out.` **145 chars, 1 segment**
- worst case: `The Anchor: Christopher, Only Fools and Horses Quiz Night is Sat 31 Oct, 7:30pm. Book seats here: https://l.the-anchor.pub/ab12cd Reply STOP to opt out.` **152 chars, 1 segment**

**`event_reminder_promo_24h_paid`**

```
The Anchor: {first_name}, {event_name} is tomorrow, {event_time}. {cost} Bring who you like. Book here: {link}
```
- typical: `The Anchor: Margaret, Music Bingo is tomorrow, 7pm. £20 a head. Bring who you like. Book here: https://l.the-anchor.pub/ab12cd Reply STOP to opt out.` **149 chars, 1 segment**
- worst case: `The Anchor: Christopher, Only Fools and Horses Quiz Night is tomorrow, 7:30pm. £20 a head. Book here: https://l.the-anchor.pub/ab12cd Reply STOP to opt out.` **156 chars, 1 segment**

### 2.3 Transactional templates (no opt-out suffix, these are service messages)

**`event_reminder_1d`** (replaces the current "don't be late!" line at route.ts:929)
```
The Anchor: {first_name}, you're all set for {event_name} tomorrow, {event_time}. Come early for a drink if you fancy. Change or cancel: {link}
```
- typical **154 chars, 1 segment**
- worst case (rung 2, drops the drink line): `The Anchor: Christopher, you're all set for Only Fools and Horses Quiz Night tomorrow, 7:30pm. Change or cancel: https://l.the-anchor.pub/ab12cd` **144 chars, 1 segment**

**`event_booking_confirmed`** (src/services/event-bookings.ts:241)
```
The Anchor: {first_name}, you're in. {seats} {seat_word} for {event_name}, {event_date}, {event_time}. See you then. Change or cancel: {link}
```
- typical **138 chars, 1 segment**
- worst case (rung 2) **152 chars, 1 segment**

**`event_booking_pending_payment`, with a payment link** (src/services/event-bookings.ts:236)

The current version renders two unlabelled links in a row. Payment link only, manage link removed:
the confirmation that follows payment already carries a labelled manage link
(src/lib/events/event-payments.ts:900).
```
The Anchor: {first_name}, {seats} {seat_word} held for {event_name}, {event_date}, {event_time}. Pay here to lock them in: {link}
```
- typical **126 chars**, worst case **154 chars**, both 1 segment

**`event_booking_pending_payment`, no payment link yet** (src/services/event-bookings.ts:238)

This branch keeps its manage link, because nothing else will reach that guest.
```
The Anchor: {first_name}, {seats} {seat_word} held for {event_name}, {event_date}, {event_time}. We'll text your payment link shortly. Change or cancel: {link}
```
- typical **156 chars**, worst case (rung 3) **141 chars**, both 1 segment

### 2.4 New reply-handling templates

**`event_reply_needs_number`** (new). Sent when someone inside a live promo window replies with
booking intent but no usable number. At most one per promo context.
```
The Anchor: {first_name}, happy to get you in for {event_name}. How many seats? Just text a number back, like 4.
```
- typical **107 chars**, worst case **131 chars**, both 1 segment

**`event_reply_needs_staff`** (new). Sent when a reply cannot be handled automatically: capacity
lookup failed, event load failed, customer resolution failed, or the booking RPC refused. Replaces
four silent `{ handled: false }` returns.
```
The Anchor: thanks {first_name}, we've got your message about {event_name}. You're not booked in yet, one of us will read it and text you back.
```
- typical **138 chars**, worst case (rung 2) **123 chars**, both 1 segment

**`event_reply_declined`** (new, optional). Sent when the reply is a clear refusal. Recommended
**not** to send this: silence plus a staff flag is the safer default. Copy provided if the owner
wants it.
```
The Anchor: no bother {first_name}, we'll catch you next time. Have a good one.
```
- **75 chars, 1 segment**

**Big group reply** (replaces the current "That's a big group!" line at reply-to-book.ts:267)
```
The Anchor: {first_name}, that's a proper crowd. Give us a ring on {venue_phone} and we'll sort the table out for you.
```
- **116 chars, 1 segment**

### 2.5 Token rules the builders must follow

| Token | Source | Rule |
|---|---|---|
| `{first_name}` | `getSmartFirstName(recipient.first_name)` | unchanged |
| `{event_date}` | new helper, `formatDateInLondon` with `weekday:'short', day:'numeric', month:'short'` | "Fri 14 Aug". **Never** the long form, it costs 6 to 18 extra characters. Do not reuse `formatEventDateTime` (route.ts:605), it returns date **and** time together |
| `{event_time}` | `formatTime12Hour(events.time)` (src/lib/dateUtils.ts:123) | "7pm", "7:30pm". Returns "TBC" on null, in which case drop the time clause entirely |
| `{cost}` | see below | |
| `{link}` | existing short-link generator | assume 31 characters in tests |

**Cost rule.** Do not derive cost from `payment_mode` alone. `isPaidEvent` (cross-promo.ts:145) only
treats `prepaid` as paid, so cash-on-door events currently take the "free" path. Use:

- `events.price > 0` renders `£{price} on the door.` for `cash_only`, `£{price} a head.` for `prepaid`
- `payment_mode = 'free'` **and** `price = 0` renders `Free entry.`
- anything else (price null, or a mismatch) renders **nothing**. Never guess "free"

Verified against prod: of upcoming events, 0 have `payment_mode='free'` with a non-zero price and 0
have `cash_only` with no price, so this rule is currently unambiguous. Priced upcoming events are
Cash Bingo £10, Music Bingo £5, Only Fools and Horses Quiz Night £3, all `cash_only`.

---

## 3. Phase 1: configuration only, no deploy

Set these in Vercel (Production), then redeploy so the module-level constants are re-read at cold
start. Every one of these is currently commented out in `.env.example:163-171`, so the code defaults
are live.

| Variable | Current effective value | Set to | Why |
|---|---|---|---|
| `EVENT_PROMO_CATEGORY_RECENCY_DAYS` | 90 | `180` | The owner's 6-month rule |
| `EVENT_PROMO_GENERAL_RECENCY_DAYS` | 42 | `180` | The cross-pollination lever. Keep it equal to the category window: general is a superset, and a lower category window only demotes people to the generic copy |
| `EVENT_PROMO_FREQUENCY_CAP_DAYS` | 7 | `3` | Events run 5 to 7 days apart, so a 7-day blackout guarantees one event is silenced. 3 days keeps a real gap |

**Do not change** `EVENT_PROMO_MAX_RECIPIENTS_PER_EVENT`, `MAX_EVENT_PROMOS_PER_RUN` or
`EVENT_PROMO_HOURLY_SEND_GUARD_LIMIT`. All three are 30, and the entire consented six-month pool is
35, so they barely bind and they are the only safety net. Revisit only if the pool passes 30 after
the Phase 4 consent work.

Also update the commented examples in `.env.example:163-171` to match, so dev and prod agree.

### Expected effect (measured read-only against prod today)

Audience returned by `get_cross_promo_audience`, per event:

| Event | Today (90/42, cap 7) | After Phase 1 (180/180, cap 3) | Ceiling with no blackout |
|---|---|---|---|
| Cash Bingo 29 Jul | 8 | 15 | 18 |
| Music Bingo 14 Aug | 10 | 15 | 25 |
| Quiz Night 19 Aug | 10 | 15 | 25 |
| Karaoke 19 Sep | 8 | 15 | 25 |

Note: cap 3 measures identically to cap 7 **today**, because the Quiz Night promo went out yesterday
and is inside both windows. The gain shows up in the steady state, where intro dates are 5 to 7 days
apart (Music Bingo 14 Aug sends on 7 Aug, Quiz Night 19 Aug sends on 12 Aug).

**Risk: low.** No code, no schema. Reversible by reverting the variables and redeploying.

**Verification.** After the redeploy, run this read-only against prod on the morning of the next
intro date (7 August) and confirm the count is in the teens, not single digits:
```sql
SELECT e.name, e.date, count(*) AS audience
FROM events e, LATERAL get_cross_promo_audience(e.id, e.category_id, 180, 180, 3, 30)
WHERE e.date = CURRENT_DATE + 7 AND e.event_status = 'scheduled'
  AND e.booking_open AND e.promo_sms_enabled AND e.category_id IS NOT NULL
GROUP BY 1, 2;
```

---

## 4. Phase 2: code

Ordered so each step is independently deployable. Steps 2.1 and 2.2 are the cost and safety fixes and
should ship first, on their own.

### 2.1 Stop sending UCS-2 (ship alone, first)

**`src/lib/sms/cross-promo.ts:156, :166, :183, :191, :200`** and
**`src/app/api/cron/event-guest-engagement/route.ts:929`** and
**`src/services/event-bookings.ts:236, :238, :241`** and
**`src/lib/sms/reply-to-book.ts:221, :313`** and **`src/lib/sms/templates.ts:16`**: remove every
U+2014. Replace with a comma or a full stop. This also satisfies the workspace no-em-dash rule.

**`src/lib/twilio.ts`, inside `sendSMS` before `client.messages.create`**: add a GSM-7 normaliser
that substitutes (never truncates) U+2014 and U+2013 to a comma, U+2019 and U+2018 to `'`, U+201C and
U+201D to `"`, U+2026 to `...`. Leave U+00A3 alone, it is valid GSM-7. This is the only control that
also covers the 25 staff-editable rows in `message_templates` and `table_booking_sms_templates`,
which a lint rule cannot reach.

**`src/lib/twilio.ts:580`**: replace `Math.ceil(smsBody.length / 160)` with `smsSegments()` from the
new `src/lib/sms/gsm7.ts`. Delete the duplicate estimate at `src/lib/sms/logging.ts:64` and point the
three client previews (`BulkMessagesClient.tsx:50`, `MessagesClient.tsx:108`,
`MessageGuestsModal.tsx:21`) at the same helper.

Effect: promo SMS segments fall by roughly two thirds. Nothing reads `segments` or `cost_usd` today,
so there is no regression surface. Risk: low. Verify by sending one test message per template to a
staff handset and confirming the Twilio console reports GSM-7 and the expected segment count. Do not
skip the console check, it is the only proof the encoding actually changed.

### 2.2 Stop an opt-out booking seats (ship with 2.1, one line)

**`src/app/api/webhooks/twilio/route.ts:809`**: change `if (!isWhatsApp) {` to
`if (!isWhatsApp && !isOptOut) {`. Today "Cancel my 4 please" sets `sms_opt_in=false`, then falls
straight through to `handleReplyToBook` and books 4 seats for a customer who just opted out. Add one
line of metadata in the opt-out block recording that reply-to-book was suppressed.

Unit-test the matcher and parser in isolation, not the route: `isOptOut` true for `STOP`,
`stop please`, `UNSUBSCRIBE`, bare `CANCEL`; and `parseSeatCount('Cancel my 4 please')` still returns
4 so the staff-attention path fires.

### 2.3 Copy swap

**`src/lib/sms/gsm7.ts`** (new): `gsm7Septets`, `smsSegments`, `fitToOneSegment` as specified in 2.1
above.

**`src/lib/sms/cross-promo.ts`**:
- Delete `buildFreeMessage` (:150) and `buildPaidMessage` (:159). Route both audience types through
  the general builders. Keep `TEMPLATE_CROSS_PROMO_FREE` and `TEMPLATE_GENERAL_PROMO_FREE` as
  distinct keys, and keep the `audience_type` written to `promo_sequence`, so reporting still
  separates the pools. Change the branch at :391 from a boolean on `isGeneral` to an explicit
  `switch` on `audience_type` so an unknown type can never fall through silently, and update the
  union type at :126.
- Rewrite the four surviving builders to the section 2.2 rung ladders, taking `eventTime` and `cost`
  as new arguments.
- Add a `formatPromoDate` helper using `formatDateInLondon` with `weekday:'short', day:'numeric',
  month:'short'`. Replace the long-form call at :357-362.
- Add `resolveCostPhrase(paymentMode, price)` implementing the cost rule in section 2.5.
- Widen the `event` parameter of `sendCrossPromoForEvent` (:249) and `sendFollowUpForEvent` (:473) to
  carry `time` and `price`.

**`src/app/api/cron/event-guest-engagement/route.ts`**:
- Add `time, price` to both event selects (:1843 and :1869) and to `UpcomingPromoEvent` (:1829).
- Replace the `event_reminder_1d` body at :929 with the section 2.3 ladder.
- Delete the six dead template keys from `EVENT_PROMO_TEMPLATE_KEYS` (:61-73):
  `event_cross_promo_14d`, `event_cross_promo_14d_paid`, `event_general_promo_14d`,
  `event_general_promo_14d_paid`, `event_reminder_promo_3d`, `event_reminder_promo_3d_paid`. They
  have no builder and no call site, and their presence inflates the hourly guard count. Leave the
  label map at `EventDetailClient.tsx:1471-1478` untouched so historical messages still display
  friendly names. Add a comment recording that the 14d/3d ladder was retired in favour of D-7 plus
  D-1, so the next reader does not re-open it.

**`src/services/event-bookings.ts:233-241`**: replace `buildEventBookingSms` with the section 2.3
ladders. Note the per-branch composition: the pending-payment branch **with** a payment link loses
its manage link, the branch **without** one keeps it.

**Tests.** Update `src/lib/sms/__tests__/cross-promo.test.ts:200, :379, :580` which pin the literal
"Reply with seats". Keep the `not.toContain` assertions at :265 and :428 that guard against a reply
ask appearing in paid copy. Add a length guard test that renders every template at
`{first_name}='Christopher'`, `{event_name}` of 40 characters, `{event_time}='7:30pm'` and asserts
GSM-7 and one segment.

### 2.4 Reply parser upgrade

**`src/lib/sms/reply-to-book.ts`**. Replace `parseSeatCount` (:57-64) with a typed staged parser, and
migrate the caller in the same commit. Reorder `handleReplyToBook` so the promo-context lookup runs
**before** any decision that produces an outbound reply, so only a phone with a live window can ever
receive a clarification.

```ts
export type SeatParse =
  | { kind: 'seats'; seats: number; confidence: 'high' | 'low'; matched: string }
  | { kind: 'decline'; matched: string }
  | { kind: 'ambiguous'; candidates: number[]; matched: string }
  | { kind: 'none' }
export function parseSeatReply(body: string): SeatParse
```

Stages, in this order:
1. **Normalise.** NFKC, lowercase, strip U+FE0F and U+20E3 explicitly (NFKC does not remove them).
2. **Decline gate.** Return `{kind:'decline'}` on: `cancel`, `cancelled`, `canceled`, `cancellation`,
   `can't make`, `cannot make`, `can not make`, `not coming`, `not able`, `no thanks`, `another
   time`, `give it a miss`, `take us off`, `remove us`. Accept both `'` and U+2019. **Do not** match
   bare `next time` (prod has "thanks see you next time Margaret" inside a decline and in friendly
   sign-offs), bare `won't` ("won't take too long") or bare `unable` ("won't let me").
3. **Mask non-seat numerics** before searching: times `\b\d{1,2}[:.]\d{2}\s*(am|pm)?\b` and
   `\b\d{1,2}\s*(am|pm)\b`, ordinals `\b\d{1,2}(st|nd|rd|th)\b`, dates `\b\d{1,2}/\d{1,2}(/\d{2,4})?\b`,
   money `£\s*\d+(\.\d+)?` and `\b\d+\s*(p|quid|pounds)\b`, phone-like runs `\+?\d[\d\s]{8,}`, and
   digits glued to letters (`m25`, `a30`).
4. **Anchored digit match.** Prefer a number adjacent to `seat`, `seats`, `place`, `places`, `people`,
   `person`, `ticket`, `tickets`, `spot`, `spots`, `of us`, `table for`, or preceded by `book`,
   `put me down for`, `reserve`, `save us`, `we'll take`. Confidence `high`.
5. **Bare number.** Whole trimmed body is `\d{1,2}` optionally with `please`, `x`, `thanks`.
   Confidence `high`. This preserves the only pattern that has ever worked in prod.
6. **Word numbers** `one` to `ten`, plus `a couple` and `a pair` as 2, `just me`, `only me`,
   `just myself` as 1. Only when anchored by a booking noun from stage 4, or when the whole message
   is that word alone. `SMS_REPLY_MAX_SEATS` is 10 (reply-to-book.ts:15), so do not map `eleven` or
   `twelve`. **Never** treat the articles `a` or `an` as 1: prod has 53 messages where that would
   fire wrongly. Confidence `high` when anchored, `low` otherwise.
7. **Additive and multi-cohort**, both requiring the same anchor: `me and 3` and `bring 2` become
   n+1; `3 adults` plus `2 kids` sums to 5. Confidence `low`, so these clarify rather than book.
8. **Ambiguous.** Two or more surviving candidates that disagree, or ranges (`3-4`, `2 or 3`,
   `a few`) return `{kind:'ambiguous'}`.
9. Otherwise `{kind:'none'}`.

Caller behaviour in `handleReplyToBook`:

| Parse result | Action |
|---|---|
| `seats`, high | book as today |
| `seats`, low, or `ambiguous` | do not book, send `event_reply_needs_number`, call `markInboundNeedsAttention`, leave the promo window open so the follow-up digit re-enters the normal path. At most one clarification per promo context |
| `decline` | do not book, do not reply, expire the promo window (same pattern as cross-promo.ts:532), call `markInboundNeedsAttention`, return `handled:false` so a human answers |
| `none` | fall through to today's behaviour: `buildLateReplyFallback` if promoted in the last 45 days, otherwise silence |

Two further fixes in the same file:
- **Ordering flip, reply-to-book.ts:81**: change `.order('reply_window_expires_at', {ascending:false})`
  to `.order('created_at', {ascending:false})` with `reply_window_expires_at` ascending as tie-break,
  so the promo the customer just read wins. Verified safe: no other reader of `sms_promo_context`
  keys on `reply_window_expires_at`.
- **Status guard, reply-to-book.ts:292**: add `event_status, booking_open` to the events select and
  refuse to book cancelled, draft or closed events, replying with `event_reply_needs_staff`. Today
  there is no status guard at all, so any future path that promotes an unpublished event would create
  bookings on an event hidden from FOH (`api/foh/events/route.ts:85`) and the public site
  (`api/events/route.ts:93`).
- **Payment guard**: load `events.payment_mode` and, when `prepaid`, do not create a booking from a
  text reply. Reply with the payment link instead. The paid copy never invited a numeric reply.
- **Silent failure paths**: at :283, :301-302, :332 and :406, stop returning `{handled:false}`.
  Return `{handled:true, response: event_reply_needs_staff}` and call `markInboundNeedsAttention`.
  Add a fifth: when `eventRow` is null with no error, do not proceed to book blind.

**Tests.** Table-driven, seeded from the literal prod bodies. Must still book: `2`, `7 seats
please.`, `Table for 6 please. Tganjs Margaret`, `book me 6 seats`, `can we book a table for 6.`
(never 7), `Two seats please if available`, `Can't get any more friends so table for 2 please xx`.
Must not book: `Cancel my 4 please`, `Hey,4 girls have just cancelled for bingo tonight`, `Hi. Sorry
3 of us on holiday so cannot make bingo on 20th.`, `arsenal playing at 8:00, so i doubt i will be
down`, `its the friday 24th`, `we are stuck on the m25`, and any body starting with `Loved` /
`Liked` / `Emphasized` (iPhone tapbacks, 6 in prod).

**Ship behind a shadow flag.** Log what the new parser would have done against live inbound for two
weeks, diff against the current parser, then enable. The venue takes about 21 inbound texts a month,
so shadow mode costs nothing and is the only way to measure the false-positive rate.

### 2.5 Intro window, per-event cap, and window hygiene

**`src/app/api/cron/event-guest-engagement/route.ts:1840-1848`**: replace `.eq('date', introDate)`
with a **catch-up-only** window that widens backwards from D-7 and never forwards:

```ts
const windowEnd = getLondonDateString(EVENT_PROMO_INTRO_DAYS_AHEAD)          // today + 7
const windowStart = getLondonDateString(EVENT_PROMO_INTRO_MIN_LEAD_DAYS)     // today + 3, new env, default 3
  .gte('date', windowStart)
  .lte('date', windowEnd)
```

Add `EVENT_PROMO_INTRO_MIN_LEAD_DAYS`, default **3**. A floor of 3 (not 1, not 2) preserves the D-1
follow-up, because `get_follow_up_recipients` requires `touch_14d_sent_at <= now - 1 day`; a floor of
2 makes that only probable. This catches an event published at D-6, D-5, D-4 or D-3, which is the
entire real gap. Nothing is pulled earlier than today's behaviour.

Add a hard assert that the window can never exceed 30 days, because route.ts:2178-2181 purges
`sms_promo_context` at 30 days and the per-event dedupe silently dies past that boundary.

**Lifetime per-event cap.** A multi-day window turns the 30-per-event cap into 30-per-run. Before
calling the RPC in `sendCrossPromoForEvent`, count existing `sms_promo_context` rows for this event
with the four intro template keys and pass
`p_max_recipients = max(0, EVENT_PROMO_MAX_RECIPIENTS_PER_EVENT - alreadySent)`.

**Budget fairness.** `processFollowUps` runs before `processCrossPromo` (route.ts:2173 then :2176)
and shares one budget of 30, and it passes its full eligible array to `sendFollowUpForEvent` with no
per-event cap. Add a per-event cap to the follow-up path so it cannot starve the intro stage.

**One open window per phone.** Widen the close at cross-promo.ts:531-536 by dropping the
`.eq('event_id', event.id)` filter, and add the same close to the intro path before the insert at
:426 (which today closes nothing). This makes "one live window per customer" an invariant at send
time, so the parser never has to choose between events. Record the trade explicitly: a customer
promoted for event A on Monday and event B on Wednesday can no longer reply-to-book event A. That is
"last promo wins", which is what `created_at desc` would choose anyway.

**Capacity gate.** `seatsRemaining` is already in scope at cross-promo.ts:291. Delete the
`EVENT_PROMO_MIN_CAPACITY` block at :300-306 (it silences an event exactly when it needs the last few
seats) and keep only the sold-out check at :292. Replace it with a demand-aware recipient cap:

```ts
const seatCap = seatsRemaining ?? EVENT_PROMO_MAX_RECIPIENTS_PER_EVENT
p_max_recipients: Math.max(1, Math.min(perEventRemaining, seatCap, EVENT_PROMO_MAX_RECIPIENTS_PER_EVENT))
```

### 2.6 Visible warning when an event will not send

Export one predicate and use it everywhere so UI and cron cannot drift:

```ts
// src/lib/events/promo-eligibility.ts (new)
export function getPromoIneligibilityReasons(event): string[]
// 'not_published' | 'bookings_closed' | 'promo_sms_disabled' | 'no_category' | 'sold_out'
```

Surface it as a badge on the event row and on the event drawer in `/events`, together with the D-7
date, so staff see it before the window passes. Warn only when the event is inside roughly
`EVENT_PROMO_INTRO_DAYS_AHEAD + 3` days, otherwise it fires on 90 per cent of the list and gets
ignored. A badge that only checks `event_status` would show green on the four category-less Music
Bingo dates and still send nothing, so it must check all four gates.

### Phase 2 expected effect, risk, verification

**Effect on volume: none directly.** Phase 2 changes what the messages say, who can reply
successfully, and whether a late-published event still gets its one shot. The volume comes from
Phase 1 and Phase 3.

**Risk: medium.** 2.4 sits on the only automated booking path the venue has. Mitigated by the shadow
flag and the prod-body regression fixtures.

**Verification.** `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` (Node 20). Then
after the first live sends, read-only:
```sql
SELECT metadata->>'template_key' AS tpl, count(*), max(length(body)) AS max_len,
       count(*) FILTER (WHERE body ~ '[^ -~£]') AS non_gsm_bodies
FROM messages
WHERE direction = 'outbound' AND created_at > now() - interval '7 days'
  AND metadata->>'template_key' LIKE 'event_%'
GROUP BY 1 ORDER BY 2 DESC;
```
Expect `non_gsm_bodies = 0` and `max_len <= 160` on every row.

---

## 5. Phase 3: database migration

**This must not be applied without the owner's explicit approval.** It changes a `SECURITY DEFINER`
function that returns customer names and mobile numbers.

Three changes, all inside `get_cross_promo_audience`:

1. **Count real attendance.** `valid_attendance` currently requires `b.status = 'confirmed'`, which
   discards 63 bookings across 49 customers where the status was later changed. Widen to an
   allowlist. Keep it an allowlist, not "everything except cancelled": `bookings.status` is untyped
   TEXT and a denylist would count `pending_payment` (reserved, never paid) as attendance.
2. **Scope the blackout to intro promos.** A D-1 reminder currently starts a fresh blackout for the
   recipient across every other event, even though it went to someone already in that event's
   sequence. Restrict both `NOT EXISTS` blackout clauses to the four intro template keys.
3. **Fix the LIMIT ordering.** `DISTINCT ON` forces `customer_id` to lead the `ORDER BY`, so the
   30-recipient cut is made in random UUID order rather than by recency. De-duplicate in an inner
   CTE, then rank and cut in the outer query. Rank recency-first so the cross-pollination audience is
   not starved by same-category priority.

Keep the six-parameter signature byte-identical and use `CREATE OR REPLACE`. Do **not** DROP and
recreate: this function already had a PostgREST `PGRST203` outage from a duplicate overload, fixed by
`20260616000000_drop_stale_cross_promo_audience_overload.sql`. Re-issue the grants anyway.

### Full migration SQL

```sql
-- supabase/migrations/YYYYMMDDHHMMSS_widen_cross_promo_audience.sql
--
-- 1. Count completed / reviewed bookings as attendance, not just 'confirmed'.
-- 2. Scope the frequency blackout to intro promos only, so a D-1 reminder
--    no longer blacks the customer out of every other event.
-- 3. Apply the recipient LIMIT after ranking by recency, not in UUID order.
--
-- Signature unchanged (6 args). CREATE OR REPLACE preserves the ACL; grants
-- are re-issued below regardless.

CREATE OR REPLACE FUNCTION public.get_cross_promo_audience(
  p_event_id UUID,
  p_category_id UUID,
  p_recency_days INTEGER DEFAULT 180,
  p_general_recency_days INTEGER DEFAULT 180,
  p_frequency_cap_days INTEGER DEFAULT 3,
  p_max_recipients INTEGER DEFAULT 30
)
RETURNS TABLE(
  customer_id UUID,
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT,
  last_event_category TEXT,
  times_attended BIGINT,
  audience_type TEXT,
  last_event_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH intro_promo_keys AS (
    SELECT unnest(ARRAY[
      'event_cross_promo_7d',
      'event_cross_promo_7d_paid',
      'event_general_promo_7d',
      'event_general_promo_7d_paid'
    ]) AS template_key
  ),
  valid_attendance AS (
    SELECT
      b.customer_id,
      e.category_id,
      e.name::TEXT AS event_name,
      e.date
    FROM bookings b
    JOIN events e ON e.id = b.event_id
    WHERE e.category_id IS NOT NULL
      AND b.seats > 0
      -- CHANGE 1: a booking later marked completed or review-clicked is still
      -- an attendance. Allowlist only: 'pending_payment' must never count.
      AND b.status IN ('confirmed', 'completed', 'review_clicked', 'visited_waiting_for_review')
      AND (b.is_reminder_only IS NULL OR b.is_reminder_only = FALSE)
      AND e.date < CURRENT_DATE
      AND (e.event_status IS NULL OR e.event_status NOT IN ('cancelled', 'draft'))
  ),
  category_attendance AS (
    SELECT
      va.customer_id,
      va.category_id,
      COUNT(*)::BIGINT AS times_attended,
      MAX(va.date) AS last_attended_date
    FROM valid_attendance va
    GROUP BY va.customer_id, va.category_id
  ),
  recent_attendance AS (
    SELECT
      ca.customer_id,
      MAX(ca.last_attended_date) AS last_attended_date
    FROM category_attendance ca
    GROUP BY ca.customer_id
  ),
  last_attended_event AS (
    SELECT DISTINCT ON (va.customer_id)
      va.customer_id,
      va.event_name AS last_event_name
    FROM valid_attendance va
    ORDER BY va.customer_id, va.date DESC, va.event_name ASC
  ),
  category_pool AS (
    SELECT
      c.id AS customer_id,
      c.first_name::TEXT,
      c.last_name::TEXT,
      c.mobile_e164::TEXT AS phone_number,
      ec.name::TEXT AS last_event_category,
      ca.times_attended,
      'category_match'::TEXT AS audience_type,
      ec.name::TEXT AS last_event_name,
      1 AS priority,
      ca.last_attended_date
    FROM category_attendance ca
    JOIN customers c ON c.id = ca.customer_id
    JOIN event_categories ec ON ec.id = ca.category_id
    WHERE ca.category_id = p_category_id
      AND ca.last_attended_date >= (CURRENT_DATE - (p_recency_days * INTERVAL '1 day'))
      AND c.marketing_sms_opt_in = TRUE
      AND c.sms_opt_in = TRUE
      AND (c.sms_status IS NULL OR c.sms_status = 'active')
      AND c.mobile_e164 IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.customer_id = c.id
          AND b.event_id = p_event_id
          AND b.status IN ('pending_payment', 'confirmed')
          AND b.is_reminder_only = FALSE
      )
      -- per-event dedupe: unchanged, this is what stops repeat messages
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.event_id = p_event_id
      )
      -- CHANGE 2: blackout counts INTRO promos only. A 24h reminder goes to
      -- someone already in this event's sequence, so it must not spend their
      -- quiet period for every other event.
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.template_key IN (SELECT template_key FROM intro_promo_keys)
          AND spc.created_at > (NOW() - (p_frequency_cap_days * INTERVAL '1 day'))
      )
  ),
  general_pool AS (
    SELECT
      c.id AS customer_id,
      c.first_name::TEXT,
      c.last_name::TEXT,
      c.mobile_e164::TEXT AS phone_number,
      NULL::TEXT AS last_event_category,
      NULL::BIGINT AS times_attended,
      'general_recent'::TEXT AS audience_type,
      lae.last_event_name,
      2 AS priority,
      ra.last_attended_date
    FROM recent_attendance ra
    JOIN customers c ON c.id = ra.customer_id
    LEFT JOIN last_attended_event lae ON lae.customer_id = c.id
    WHERE ra.last_attended_date >= (CURRENT_DATE - (p_general_recency_days * INTERVAL '1 day'))
      AND c.marketing_sms_opt_in = TRUE
      AND c.sms_opt_in = TRUE
      AND (c.sms_status IS NULL OR c.sms_status = 'active')
      AND c.mobile_e164 IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookings b
        WHERE b.customer_id = c.id
          AND b.event_id = p_event_id
          AND b.status IN ('pending_payment', 'confirmed')
          AND b.is_reminder_only = FALSE
      )
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.event_id = p_event_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM sms_promo_context spc
        WHERE spc.customer_id = c.id
          AND spc.template_key IN (SELECT template_key FROM intro_promo_keys)
          AND spc.created_at > (NOW() - (p_frequency_cap_days * INTERVAL '1 day'))
      )
      AND NOT EXISTS (
        SELECT 1 FROM category_attendance ca2
        WHERE ca2.customer_id = c.id
          AND ca2.category_id = p_category_id
          AND ca2.last_attended_date >= (CURRENT_DATE - (p_recency_days * INTERVAL '1 day'))
      )
  ),
  combined AS (
    SELECT * FROM category_pool
    UNION ALL
    SELECT * FROM general_pool
  ),
  -- CHANGE 3: de-duplicate first, then rank, then cut. DISTINCT ON forces
  -- customer_id to lead its own ORDER BY, so applying LIMIT there cuts in
  -- UUID order. Ranking is recency-dominant so cross-category guests are not
  -- starved by same-category priority.
  deduped AS (
    SELECT DISTINCT ON (cb.customer_id)
      cb.customer_id,
      cb.first_name,
      cb.last_name,
      cb.phone_number,
      cb.last_event_category,
      cb.times_attended,
      cb.audience_type,
      cb.last_event_name,
      cb.priority,
      cb.last_attended_date
    FROM combined cb
    ORDER BY cb.customer_id, cb.priority ASC, cb.last_attended_date DESC
  )
  SELECT
    d.customer_id,
    d.first_name,
    d.last_name,
    d.phone_number,
    d.last_event_category,
    d.times_attended,
    d.audience_type,
    d.last_event_name
  FROM deduped d
  ORDER BY d.last_attended_date DESC, d.priority ASC, d.customer_id ASC
  LIMIT p_max_recipients;
END;
$function$;

-- Grants: this function is SECURITY DEFINER and returns names and mobile
-- numbers. Re-issue unconditionally even after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cross_promo_audience(UUID, UUID, INT, INT, INT, INT)
  TO service_role;
```

Do **not** add an index on `sms_promo_context`. The table is 60 rows and 152 kB with a 30-day
cleanup; an index can never pay for itself.

### Phase 3 expected effect

Measured read-only by replaying the proposed logic against Music Bingo 2026-08-14:

| Configuration | Audience |
|---|---|
| Live today (90/42, cap 7, confirmed only) | **10** |
| Phase 1 only (180/180, cap 3, confirmed only) | **15** |
| Phase 1 + Phase 3, as of today | **28** |
| Phase 1 + Phase 3, with no recent promo in the blackout window | **35** |

Reachable ceiling across the whole database: 353 customers have consented to marketing texts, and 35
of those attended a categorised past event within 180 days. 35 is therefore the hard ceiling until
Phase 4 consent work lands.

**Risk: medium.** No data is destroyed, but a mistake in this function silences every promo
venue-wide, and a grant mistake exposes customer mobile numbers.

**Verification, before claiming done:**
```sql
-- a. exactly one signature, correct parameter names
SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'get_cross_promo_audience';
-- expect exactly 1 row containing p_recency_days and p_general_recency_days

-- b. ACL is exactly postgres and service_role
SELECT p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_cross_promo_audience';
-- expect {postgres=X/postgres,service_role=X/postgres}
-- anything containing anon or authenticated is a PII exposure: roll back immediately

-- c. nobody was REMOVED, only added
SELECT count(*) FROM get_cross_promo_audience('<music bingo id>', '<cat id>', 90, 42, 7, 30);
-- diff the customer_ids against the pre-change result captured before deploying
```

---

## 6. Phase 4: data hygiene, owner actions in the app

None of Phases 1 to 3 sends a single extra text until these are done. **18 of the next 20 events are
drafts, and the promo query only accepts `event_status = 'scheduled'`.**

### 4.1 Publish the events (owner decision, per event, not a bulk update)

Publishing also lists the event on the public website (`api/events/route.ts:93`), shows it on the FOH
screen (`api/foh/events/route.ts:85`) and opens bookings (`actions/events.ts:2813`). Do it through
the event drawer in `/events`, one at a time, after checking each one is genuinely confirmed.

Hard deadlines, because the intro window closes at D-3 even after the Phase 2 widening:

| Event | Date | Publish by |
|---|---|---|
| Quiz Night | 19 Aug 2026 | 16 Aug 2026 |
| Cash Bingo | 2 Sep 2026 | 30 Aug 2026 |
| Music Bingo | 11 Sep 2026 | 8 Sep 2026 (also needs a category, see 4.2) |
| Quiz Night | 16 Sep 2026 | 13 Sep 2026 |
| Karaoke | 19 Sep 2026 | 16 Sep 2026 |
| Only Fools and Horses Quiz Night | 25 Sep 2026 | 22 Sep 2026 |

Everything from 30 Sep 2026 onwards is also draft and follows the same rule.

### 4.2 Set the missing categories

Four Music Bingo dates have `category_id` NULL and will send nothing even once published:
2026-09-11, 2026-10-16, 2026-11-13, 2026-12-11. Set them to the Music Bingo category
(`8493fffe-b218-484c-8646-4e28cfd6c2f8`).

Prevention, code, small: enforce a category on the **create** path only, with an explicit guard in
`createEvent` before `eventSchema.safeParse` at `src/app/actions/events.ts:383`, and make the category
select a required field in `src/app/(authenticated)/events/_components/EventDrawer.tsx`. **Do not**
make `category_id` required in the shared `eventSchema` at `src/services/events.ts:381`: the update
path reuses it via `.partial()` and 56 existing events (52 of them World Cup fixtures) have no
category and must stay editable.

### 4.3 Check the payment mode on the drafts

The draft Cash Bingo dates are set to `payment_mode = 'free'` while the live one is `cash_only` at
£10. Under the new copy that difference is customer-visible: one says "Free entry." and the other
says "£10 on the door." Fix the mode and price before publishing.

### 4.4 Consent capture (separate piece of work, biggest long-run lever)

353 of 967 customers have consented to marketing texts, and 483 customers have dined but never booked
an event, so they are structurally invisible to the event audience. The marketing checkbox already
exists and already writes correctly (live rows from `public_event_booking` as recently as 2026-07-21).
The gap is conversion: the event form converts about 3 in 23, the table form about 1 in 71. That is a
placement and wording problem on the table-booking form, not a missing field.

**Do not** send a consent-refresh SMS to the 324 service-consented customers. That is direct
marketing to people with no recorded lawful basis. Capture consent at the next service touchpoint
instead: the booking confirmation page, an in-venue QR, or staff capture at the till via
`applyStaffCapturedConsent`. Measure by consent capture date from `customer_consents`, not by
customer creation date.

---

## 7. Open decisions for the owner

1. **Publish the 18 draft events?** Recommend yes, one at a time through the event drawer, starting
   with Quiz Night 19 Aug (deadline 16 Aug). Nothing in this whole piece of work sends a single text
   until this happens.
2. **Say the price in the invite?** Recommend yes. "£5 on the door." is 15 characters, it answers the
   first question a customer asks, and without it a share of replies will be questions rather than
   numbers. The rule is safe: we only state a price when `events.price > 0`, and only say "Free
   entry." when the mode is free and the price is zero.
3. **Six months or twelve?** Recommend six, as asked. Six months reaches 35 consented attendees,
   twelve reaches 63. The extra 28 are one-off Halloween, Christmas and New Year guests with no
   recorded consent date or source, so texting them is a complaint risk for five extra recipients per
   event after the 30 cap.
4. **Frequency cap of 3 days, or 7 as now?** Recommend 3. Events run 5 to 7 days apart, so a 7-day
   blackout mathematically guarantees one of any two events in a week gets silenced. A separate rule
   already limits every customer to one promo per calendar day.
5. **Reply "no thanks" politely, or stay silent and flag for staff?** Recommend silent plus a staff
   flag. The customer asked the venue a question, not the bot, and an auto-reply to a refusal reads
   badly. Copy is drafted in section 2.4 if you would rather it replied.
6. **Move invites off 9am?** Recommend not yet. Every promo has landed at 9am for at least 45 days,
   and all three bookings this system has ever produced came from 9am sends. Log the send hour, widen
   the audience first, then compare bookings per recipient by hour over a few event cycles before
   locking a window.
7. **Add a third touch, for example three days before?** Recommend no. Six template keys for a 14-day
   and 3-day touch already exist in the code with no builder behind them; delete them. Adding
   frequency to an audience of 10 before fixing the gate that blocks 10 of 13 eligible people
   optimises the wrong end of the funnel and risks STOP opt-outs from the most engaged customers.
   Revisit after four weeks at the widened audience size.
8. **Marketing consent on the table-booking form?** Recommend yes as a small separate change. The
   table form converts consent at about 1 in 71 against the event form's 3 in 23, and the
   table-booking base is 483 customers who are currently invisible to event invites.

---

## 8. Sequencing summary

| Order | What | Deploy | Risk | Volume effect |
|---|---|---|---|---|
| 1 | Phase 2.1 and 2.2: remove the long dash, encoding-aware segments, opt-out guard | code | low | none, cuts SMS cost by roughly two thirds |
| 2 | Phase 1: three environment variables | config | low | 8 to 10 becomes 15 per event |
| 3 | Phase 4.1 to 4.3: publish events, set categories, fix payment modes | owner, in app | medium (goes public) | without this everything after 14 Aug is zero |
| 4 | Phase 3: the migration | migration, owner approval | medium | 15 becomes 28 to 35 per event |
| 5 | Phase 2.3 and 2.5: copy swap, intro window, per-event caps | code | medium | protects against a missed send day |
| 6 | Phase 2.4: parser upgrade, shadow mode for two weeks, then enable | code | medium | more replies convert to bookings |
| 7 | Phase 2.6: the "will not send" badge | code | low | prevents recurrence |
| 8 | Phase 4.4: consent capture | separate spec | low | the only way past a ceiling of 35 |
