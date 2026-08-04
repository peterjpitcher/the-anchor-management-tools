# Seasonal pre-orders: the small version

Date: 2026-08-04
Supersedes: v1 (`...spec-2026-08-03.md`) and v2 (`...spec-v2-2026-08-04.md`), both rejected.
Status: **for build.**

---

## Why this document is short

Version 1 was rejected by an external developer with 44 findings. Version 2 answered them and grew to
twelve tables and 6,600 lines, then failed its own adversarial review with 35 blocking defects,
including SQL that would not apply to a database.

The lesson was not "fix the defects". It was that the design had outgrown the problem. A pub taking
Christmas dinner orders had acquired an outbox state machine, a refund saga, content fingerprints and a
readiness gate.

This version does the job with **three new tables and no new infrastructure**, by reusing four things
that already exist and are already in production. Everything cut is listed in section 9 so nobody
believes it was forgotten.

## 1. What we are replacing

**Verified on 2026-08-04.** Christmas today is not a booking system. `app/christmas-parties/` posts to
`/api/enquiry/christmas`, which sends an email to the pub. A person then rings the guest back and takes
everything, including food choices, by phone or email. No table booking is created by that path.

So the bar is low. Anything that captures choices against a real booking and prints them for the kitchen
is an improvement on a mailbox.

**Owner decision, confirmed 2026-08-04:** Christmas moves to online booking through `/book-table`, using
the seasonal period machinery already live.

## 2. What already exists and is reused, not rebuilt

| Reused | Where | What it saves |
|---|---|---|
| Seasonal periods, menus, deposits, the guest question | `booking_periods`, `booking_period_menu_items`, `/api/table-bookings/periods` | The whole seasonal backend. Live already. |
| The booker's manage-booking link | `createTableManageToken`, `/g/<token>/table-manage` | **The entire token design.** Hashed, expiring, public-routed, already built. |
| The A4 kitchen sheet | `src/lib/table-booking-sheet-template.ts`, `/api/boh/table-bookings/booking-sheets` | Puppeteer, PDF, permissions, audit. Add one optional block. |
| The jobs queue | `src/lib/job-types.ts` (`send_sms`, `send_email`) | Delivery, retries, rate limits. |

**The single biggest simplification:** in this version only the **booker** enters choices, and the booker
is already a customer with an existing manage link. So there is no new token table, no nullable
`guest_tokens.customer_id`, and open question O1 disappears entirely. It was only ever a problem because
we wanted to message third parties.

## 3. The rule for what counts as ordered

**Owner answer, 2026-08-04: courses are chosen per person, not per table.**

- Every cover must have a **main**. That is the whole requirement.
- A starter and a dessert are **optional**. Not choosing one is a complete answer, not a missing one.
- Covers in the same party may differ: one person has three courses, the next has just a main.

A booking is ready when it has one cover row per seat and every cover has a main. That is the entire
completeness rule, and it is a single SQL predicate.

This deliberately drops v2's three-state "chosen / declined / not answered" model per course. With only
the main required, "not chosen" and "declined" mean the same thing for every optional course, so the
distinction bought nothing and cost a great deal.

**Required content change.** The live site currently sells course count as one choice for the whole
table (`christmas-course-tier`, "how many courses you want"), and tells enquirers "1 course is pre-book
only". That contradicts the decision above. Fourteen files carry the old promise, including page copy,
meta descriptions and JSON-LD schema on an indexed page carrying ad spend. This copy must change in the
same release. It is content work, not engineering, but the release is wrong without it.

## 4. The data model, in full

```sql
-- One row per seat at the table.
CREATE TABLE public.booking_preorder_covers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  ordinal          integer NOT NULL CHECK (ordinal >= 1),
  guest_name       text CHECK (guest_name IS NULL OR length(guest_name) <= 100),
  -- A service requirement, never a diagnosis. See section 8.
  dietary_note     text CHECK (dietary_note IS NULL OR length(dietary_note) <= 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_booking_id, ordinal)
);

-- One row per course that cover is having. A cover with only a main has one row.
CREATE TABLE public.booking_preorder_selections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cover_id     uuid NOT NULL REFERENCES public.booking_preorder_covers(id) ON DELETE CASCADE,
  course       text NOT NULL CHECK (course IN ('starter', 'main', 'dessert')),
  menu_item_id uuid NOT NULL REFERENCES public.booking_period_menu_items(id),
  -- Frozen at the moment of choosing, so a later menu edit cannot rewrite history
  -- or make the kitchen list disagree with what the guest picked.
  item_name    text NOT NULL,
  price_gbp    numeric(10,2),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cover_id, course)
);

-- At most one of each kind per booking. The unique constraint IS the idempotency:
-- a cron that runs twice cannot send twice.
CREATE TABLE public.booking_preorder_reminders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('booker_reminder', 'manager_escalation')),
  sent_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_booking_id, kind)
);
```

Three tables. All cascade from the booking, so a deleted booking cleans up after itself.

**RLS and grants.** All three are service-role only, matching how `booking_periods` is already secured.
Every read and write goes through a server action or an API route that has already checked permission.
No public client ever touches them directly.

**Indexes.** `booking_preorder_covers (table_booking_id)` comes free with the unique constraint.
`booking_preorder_selections (cover_id)` likewise. Add
`booking_preorder_selections (menu_item_id)` so the withdrawn-item check in section 7 is not a scan.

### 4.1 The one invariant, and where it is enforced

Cover count must equal party size. It is enforced in the **server action that writes covers**, not in a
deferred database trigger.

v2 put this in a deferred constraint trigger and its own reviewer found that this breaks all four live
party-size writers, including a SQL-level one inside the communal-event reallocation function, none of
which can wrap two calls in one transaction through supabase-js. So: when party size changes, the
existing amendment path calls one new function, `preorder_sync_covers(booking_id)`, which adds or removes
cover rows to match. Removing drops the highest ordinals first, and returns what it dropped so the caller
can tell the booker.

A nightly check reports any booking where the counts disagree. Reporting a drift beats refusing a
booking.

## 5. Who enters the choices

**The booker**, on the manage-booking page they already get a link to, at
`/g/<token>/table-manage`. A new section appears there when the booking has a seasonal period that
requires a pre-order. One block per seat: an optional name, a main (required), an optional starter, an
optional dessert, and an optional dietary note.

**Staff**, on the AMS booking detail page, with the same fields. This is the path that matters most in
year one, because staff are already on the phone to these guests today.

Both write through the same server action, so there is one rule and one audit trail.

Editing is allowed until the cutoff. After the cutoff the form is read-only and says to ring the pub.

## 6. What the kitchen gets

1. **On the A4 booking sheet**, which already exists: an optional pre-order block listing each cover, its
   name if given, its courses, and its dietary note. `TableBookingSheetData` gains one optional field.
   A snapshot test must prove non-seasonal sheets stay byte-identical.
2. **On the BOH day view**: dish totals for the date, grouped by course, so the kitchen can order and
   prep. This is a single grouped query over the selections for that day's bookings.
3. **Booking-level allergies already exist** on `table_bookings.allergies` and are already displayed.
   Every kitchen output must show both that and the new per-cover notes, each labelled. Without this the
   new sheet would silently drop an allergy the pub records today.

## 7. Chasing, in one cron

One daily cron, `/api/cron/preorder-reminders`, scheduled in `vercel.json`.

For every future booking with a seasonal period that requires a pre-order and is not yet complete:

| When | What | Idempotency |
|---|---|---|
| 7 days before the booking | SMS and email the booker their manage link | `booker_reminder` row |
| At the cutoff (`preorder_cutoff_days` before, at noon London) | Email `manager@the-anchor.pub` naming the booking, who to call and what is missing | `manager_escalation` row |

Two messages, maximum, ever. Sending is handed to the existing jobs queue. The unique constraint on the
ledger is written in the same transaction that enqueues, so a double run cannot double send.

An incomplete order never cancels a booking. It becomes a phone call, which is exactly how the pub
handles it today.

**Withdrawn menu items.** If a manager deactivates an item that live orders reference, the manage screen
and the staff screen both show those covers as needing a new choice, and the nightly report lists them.
No mass re-messaging: at the volumes involved a manager can ring the affected bookings, and an automated
burst to every Christmas booker is a worse outcome than a short call list.

## 8. Dietary notes and the law

`dietary_note` is free text a guest types about their own requirements. It can amount to health
information, which under UK GDPR is special-category data needing an Article 9 condition as well as an
Article 6 basis. The v1 claim that recording it as "a requirement, never a reason" changes its
classification was **wrong**, and the external reviewer was right to call it out.

This version reduces the exposure rather than pretending to settle the law:

- The field is optional, capped at 200 characters, and labelled as a dietary requirement, not a medical
  question.
- The form says plainly that anyone with a serious allergy should ring the pub, because a text box is not
  a safe channel for that.
- It is shown only to staff and the kitchen, never in a manager digest, never in logs or telemetry.

**Owner decision, 2026-08-04.** The concern in this section was raised and the owner has decided: the
information is kept so that staff can see it and prepare the food safely, and it is retained for two
years so a returning guest's requirements can be referenced. That is the controller's decision to make
and it is a coherent purpose.

What this means in practice, and what is built to it:

- **Purpose:** preparing food safely for a specific guest, and recognising a returning guest's
  requirements. Recorded here so the reason is on the record rather than assumed.
- **Access:** staff and kitchen only, on a permission-gated screen. Never emailed, never in a manager
  digest, never in logs, telemetry or analytics.
- Still worth doing, though it blocks nothing: write the Article 6 basis and the Article 9 condition
  down somewhere permanent, and add a line to the privacy notice saying the pub keeps dietary
  requirements for two years. The build does not wait on it.

## 9. Retention

**Owner decision, 2026-08-04: two years, everything.** Dish choices for ordering and capacity planning,
and names and dietary notes so a returning guest's requirements can be looked up.

| Data | Kept | Why |
|---|---|---|
| Dish choices, course counts, covers per booking | 2 years | Ordering and capacity planning |
| `guest_name` | 2 years | Ties a requirement to a person on a return visit |
| `dietary_note` | 2 years | Owner decision in section 8: staff must be able to reference it |
| Reminder ledger | 2 years | Cheap, and answers "did we chase them?" |

The nightly retention cron deletes cover and selection rows two years after the booking date. One rule,
one period, nothing to get out of step.

An earlier draft split this, keeping dish data for two years and deleting names and dietary notes at
ninety days, on the grounds that planning needs no personal data. The owner's purpose is broader than
planning, so the split does not serve it and has been dropped.

## 10. What is deliberately NOT in this version

Listed so nobody thinks it was overlooked. Each is real, and each is Phase 2 or later.

| Cut | Why it is safe to cut |
|---|---|
| Per-guest phone numbers and guest self-service links | The owner's idea and a good one, but it is the source of nearly every serious risk: third-party consent, STOP handling, token sprawl, per-guest privacy. Year one, the booker or staff types it in. |
| The SMS chase ladder | Two messages replace four points times N contacts. |
| A durable outbox state machine | The existing jobs queue already retries. Two messages per booking does not justify a new delivery subsystem. |
| Automatic deposit refunds on amendment | Real work the owner asked for, but it is about deposits, not pre-orders. Neither blocks the other. It is its own piece of work. |
| Content fingerprints and print-run ledgers | Solves selective reprint. The kitchen reprints the sheet. |
| A multi-switch readiness gate | One setting, `preorder_enabled`, default off. |
| Party-level required-course configuration | The owner's answer made the main mandatory and everything else optional, which needs no configuration. |

## 11. Build order

1. Migration: three tables, plus `preorder_sync_covers`. Additive, no destructive statements.
2. The server action and the staff screen. Staff can now take orders on the phone, which is the whole job
   done from the pub's point of view.
3. The kitchen sheet block and the BOH day totals.
4. The booker section on the manage page.
5. The reminder cron, scheduled in `vercel.json`.
6. The Christmas page copy change from section 3.
7. Turn `preorder_enabled` on, then publish the menu.

Steps 1 to 3 are shippable on their own and already beat the mailbox. If everything after step 3 slipped,
Christmas would still work.

## 12. Testing

- Completeness predicate: a cover with only a main is complete; a cover with a starter and no main is not.
- `preorder_sync_covers` on growth and shrink, including which ordinals were dropped.
- Snapshot: a non-seasonal booking sheet is byte-identical to today's.
- Both allergy sources appear on the kitchen sheet, labelled.
- The reminder cron run twice sends once.
- Retention nulls names and dietary notes at 90 days and keeps the dish rows.
- A booking whose menu item was withdrawn shows as needing a new choice.

## 13. Open decisions

**None. All three were closed by the owner on 2026-08-04:**

1. Dietary notes are kept and shown to staff so they can prepare the food, retained two years
   (section 8). Writing the lawful basis down remains good practice but blocks nothing.
2. The Christmas page copy changes to per-person courses (section 3).
3. Build everything in section 11.
