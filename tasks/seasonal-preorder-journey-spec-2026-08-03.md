# Seasonal pre-order journey: full specification

Date: 2026-08-03
Status: **for third-party review. Nothing in Parts B to E has been built.**
Repos: `OJ-AnchorManagementTools` (AMS) and `OJ-The-Anchor.pub` (website)

---

## 0. What this document is for

The seasonal booking feature (Christmas, Mother's Day, Easter, Father's Day) has a working backend
and, as of today, a working guest-facing question. What it does not have is any way to collect,
store or chase the actual food choices. This spec covers that, plus four smaller decisions the owner
has made alongside it.

A reviewer should read Part B most carefully. It is the largest piece, it touches third-party
personal data, and it is the only part with an external deadline.

---

## 1. Owner decisions already made

These are settled. A reviewer may challenge them, but they are not open questions.

| # | Decision |
|---|---|
| D1 | Build per-guest pre-order storage in AMS. A production migration is expected. |
| D2 | Seasonal amendments **do** automatically refund the difference. Manual correction was rejected. |
| D3 | Operational alerts go to `manager@the-anchor.pub` by email, batched every 15 minutes. |
| D4 | The completed branches are merged and deployed. |
| D5 | The old four-step booking path is deleted **now**. The owner does not want the rollback kept. |
| D6 | "Special event" on the book-table page means a **seasonal menu period**, not a ticketed event night. It appears only within that period's date range. |
| D7 | An incomplete pre-order at the cutoff does **not** cancel the booking. It emails `manager@the-anchor.pub` so someone can call the guest. |
| D8 | Chase order: guests first, then the booker, then escalate to the manager by email. |
| D9 | Chase cadence: on booking, 7 days before, 4 days before, and the cutoff. Maximum four messages per person, stopping the moment they complete. |
| D10 | The booker must confirm they have permission before we message anyone whose number they supplied. Our first message identifies the pub. |
| D11 | A guest sees only their own choices, never the whole table's. |
| D12 | One phone number may cover more than one person (a parent ordering for a family of four). |
| D13 | Party size grows: ask for the extra choices. Shrinks: keep the earliest, tell the booker what was dropped. Email the manager either way. |
| D14 | Guests are contacted by SMS. The booker gets both SMS and email. |

---

## 2. Verified current state

Checked in the code on 2026-08-03, not assumed.

**Exists and works:**
- `booking_periods` and `booking_period_menu_items` (the menu to display), migrations `20260803000100`
  and `20260803000200`, applied to production.
- `GET /api/table-bookings/periods` (website, API key) and `GET /api/foh/periods` (staff, session).
- The guest-facing seasonal question, the deposit quote, and `booking_period_id` /
  `booking_period_answer` reaching the create RPCs.
- The FOH and BOH seasonal question for non-Christmas periods.
- A deposit **snapshot** on every booking: `deposit_rule`, `deposit_basis`, `deposit_rate`,
  `deposit_amount`. This is what makes D2 achievable.
- A hashed, expiring guest-token pattern with public `/g/<token>/...` routes, already allowlisted in
  `src/middleware.ts`.
- Chase-cron precedents: `employee-invite-chase`, `event-payment-reminders`, `recruitment-reminders`.

**Does not exist:**
- Any storage for a guest's food choices against a seasonal period. `booking_period_menu_items` is
  the menu to show, not what anyone ordered.
- Any pre-order chase. `src/app/api/cron/sunday-preorder/route.ts` is a stub returning
  `sunday_preorders_retired` and is **not scheduled** in `vercel.json`.
- Any concept of a guest contact who is not the booker.

**Reusable but not directly usable:**
- `table_booking_items` (from the retired Sunday-lunch pre-order) has the right columns
  (`guest_name`, `quantity`, `special_requests`, `price_at_booking`) but its `menu_item_id` points at
  the general `menu_items` table, not `booking_period_menu_items`. Reusing it would make one column
  mean two different things. **Recommendation: do not reuse it.**

**Known blocker, needs a reviewer's opinion:**
- `guest_tokens.customer_id` is `NOT NULL` with a foreign key to `customers`. A pre-order link for a
  guest who is not the booker therefore cannot be issued without either creating a customer record
  for that person or changing the schema. See §B.4 and Open Question O1.

---

## Part A. Seasonal selection on the book-table page (D6)

### A.1 What is already built

When a live period covers the chosen date, the booking form renders the period's own
`guest_question` above the slot grid as a yes/no choice, with "No thanks" always available. Outside
the period's dates nothing renders and the journey is unchanged. An inactive period is invisible.

**This already satisfies D6.** The reviewer should confirm that reading rather than take it on trust:
`components/features/TableBooking/SeasonalPeriodQuestion.tsx` and `useBookingPeriod.ts`.

### A.2 Also already built (a defect found during this work)

The bar opens on days and at hours the kitchen does not, and availability correctly reports those as
drinks-only times. A guest could answer "yes, Christmas dinner" and then choose one of them, booking
a Christmas lunch into a service that does not exist. Accepting a period now narrows the grid to
times the kitchen can serve, enforced inside `judgeSlot`, the single rule every consumer reads, and
paired with a note naming the reason and the phone number.

### A.3 Remaining work in Part A

1. The question currently reads as a yes/no. Confirm with the owner that the wording on the live
   Christmas period (`guest_question`, authored in Settings) actually reads as a **selection** of the
   seasonal menu, since that is what D6 asks for. This is content, not code.
2. When a period is live but `bookable: false` (menu not published), the guest sees the reason and no
   choice. Confirm that wording is acceptable to the owner.

---

## Part B. Pre-order persistence and collection

This is the substantial piece. It has a real deadline: the Christmas period runs 10 November to
20 December 2026 and the menu is expected in October, so this needs to be built and tested in
September at the latest.

### B.1 Concepts

**Contact.** A person responsible for submitting choices. Every booking that needs a pre-order has at
least one: the booker. The booker may add more, each with a phone number and a number of covers they
are ordering for (D12).

**Cover.** One seat at the table. Every cover needs a food choice. The covers across all contacts
must sum to the booking's party size. This is the invariant the whole feature rests on.

**Selection.** One chosen dish, for one cover, for one course.

### B.2 Data model (D1)

Two new tables. Both cascade from the booking, so deleting a booking cleans up after itself.

```sql
CREATE TABLE public.booking_preorder_contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id  uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  booking_period_id uuid NOT NULL REFERENCES public.booking_periods(id),
  -- Who this is. `is_booker` marks the one contact that always exists.
  is_booker         boolean NOT NULL DEFAULT false,
  display_name      text,
  phone_e164        text,
  -- How many people this contact orders for. D12: one number may cover a family.
  covers            integer NOT NULL CHECK (covers >= 1),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'partial', 'complete', 'unreachable', 'opted_out')),
  completed_at      timestamptz,
  chase_count       integer NOT NULL DEFAULT 0,
  last_chased_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ON public.booking_preorder_contacts (table_booking_id)
  WHERE is_booker;                     -- exactly one booker contact per booking
CREATE UNIQUE INDEX ON public.booking_preorder_contacts (table_booking_id, phone_e164)
  WHERE phone_e164 IS NOT NULL;        -- the same number cannot be added twice

CREATE TABLE public.booking_preorder_selections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id   uuid NOT NULL REFERENCES public.booking_preorder_contacts(id) ON DELETE CASCADE,
  cover_index  integer NOT NULL CHECK (cover_index >= 1),
  course       text NOT NULL,
  menu_item_id uuid NOT NULL REFERENCES public.booking_period_menu_items(id),
  -- Snapshots, so a manager editing the menu later cannot rewrite what a guest chose or was quoted.
  item_name    text NOT NULL,
  price_gbp    numeric(10,2),
  guest_name   text,
  notes        text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id, cover_index, course)
);
```

**Why snapshots.** A manager can edit the menu in Settings after orders are in. Without
`item_name` and `price_gbp` frozen on the row, a rename would silently rewrite history and the
kitchen list would stop matching what the guest chose. Same reasoning as the deposit snapshot.

**Why no `table_booking_id` on selections.** It is reachable through the contact, and denormalising
it invites the two to disagree. Kitchen queries join.

### B.3 What "complete" means

A cover is complete when it has a selection for every **required course**. A contact is complete when
all its covers are. A booking is complete when all its contacts are.

Required courses are derived from the published menu: every distinct `course` that has at least one
active item, excluding `side`, `drink` and `other`. A new nullable column
`booking_periods.required_courses text[]` overrides that when a manager needs something different.

**Reviewer: this is the definition most likely to be wrong.** If a Christmas menu publishes starters,
mains and desserts, this demands all three from every guest. If the pub intends dessert to be
optional, the override column is the escape hatch, but the default should match the pub's actual
intent. Worth confirming with the owner before building. See Open Question O4.

### B.4 The guest link

Guests submit through `/g/<token>/preorder`, using the existing hashed-token pattern. `action_type`
gains a new value `preorder` (the constraint already carries a leftover `sunday_preorder`, so the
pattern is established).

**The blocker.** `guest_tokens.customer_id` is `NOT NULL`. Three options:

- **(a) Make `customer_id` nullable and add `preorder_contact_id`.** A guest contact is not a
  customer: they have not booked anything and did not give us their number themselves. Creating
  customer records for them would fold third-party data into the marketing-capable customer table.
  **Recommended.**
- **(b) Create a customer record per guest.** Least schema change, worst data-protection posture, and
  it pollutes the customer list with people who never transacted.
- **(c) A separate `preorder_tokens` table.** Clean, but a second token mechanism is a second thing to
  get wrong, and the existing one is already hardened and public-routed.

Token expiry: the booking's start time plus 24 hours. A guest who is late but pre-service can still
submit; nobody can use a link from a finished booking.

### B.5 The booker's journey (website)

At the point the seasonal question is answered "yes" and the period requires a pre-order:

1. The booker chooses **who is ordering**:
   - "I will choose for everyone" (one contact, covers = party size), or
   - "I will add other people's numbers" (the booker's own covers, plus one row per additional
     contact with a name, a mobile number and a cover count).
2. The cover counts must sum to the party size. The form will not submit otherwise, and states the
   remaining number rather than just refusing.
3. If any additional number is supplied, the booker must tick a permission confirmation (D10). The
   wording states plainly that we will text those people about this booking.
4. The booker may submit their own covers' choices immediately, or take the link and do it later.

The booking is created and the deposit taken **regardless** of whether choices are in. A pre-order is
not a condition of holding the table. D7 says an incomplete order never cancels a booking, and it
would be worse to fail a booking at the payment step over a missing dessert choice.

### B.6 The guest journey

An SMS naming the pub, the booking date, and what is being asked, with the link. The page shows only
that contact's covers (D11), a course-by-course picker per cover, an optional name per cover so the
kitchen can match plates to people, and a free-text notes field for allergies.

On submit, the contact becomes `complete` and chasing stops for them. They can return through the
same link and change their choices until the cutoff.

**Allergies note.** Free text about allergies is health-adjacent. It is a service requirement, not a
diagnosis, and must be treated the same way the codebase already treats accessible-table requests:
recorded as a requirement, never as a reason. Reviewer should sanity-check the wording.

### B.7 The chase ladder (D8, D9)

Chase points are relative to the **booking date**: on booking (T0), 7 days before, 4 days before, and
the period's `preorder_cutoff_days` before. Rules:

- A point already in the past when the booking is made is skipped. A booking made two days out gets
  T0 and the cutoff only.
- A point falling on or after the cutoff is skipped, except the cutoff itself. This matters because
  `preorder_cutoff_days` is configurable and could exceed 7.
- Maximum four messages per contact. Chasing stops the instant a contact completes.

Ladder per point:

Channels per D14: guests by SMS, the booker by SMS and email, the manager by email.

| Point | Guests incomplete | Booker | Manager |
|---|---|---|---|
| T0 | SMS with their link | SMS + email, own link plus a status summary | nothing |
| 7 days | SMS chase | nothing | nothing |
| 4 days | SMS chase | SMS + email naming who is outstanding | nothing |
| Cutoff | final SMS | final SMS + email | **email if still incomplete** (D7) |

The manager email names the booking, who is missing, and the phone numbers to call.

Delivery runs off the existing jobs queue, driven by one new cron. It must be idempotent: a cron that
runs twice must not send twice. Recommendation: a `booking_preorder_chases` ledger keyed on
`(contact_id, chase_point)` with a unique constraint, written before sending.

### B.8 Party size changes (D13)

**Grows.** New covers are added to the booker's contact by default. The booker is notified and can
reassign them to a new contact. The manager is emailed.

**Shrinks.** Selections are kept in `submitted_at` order and the latest are dropped, so the people who
replied promptly keep the meal they chose. The booker is told exactly which were dropped. The manager
is emailed so a call can be made if the wrong person lost their choice.

Both paths must keep the covers-sum-to-party-size invariant true, in the same transaction as the
party-size change.

### B.9 Edge cases

| # | Case | Handling |
|---|---|---|
| E1 | Booking cancelled | Stop all chases, expire tokens, keep rows for audit |
| E2 | Guest replies STOP | Mark `opted_out`, stop chasing them, escalate that cover to the booker |
| E3 | SMS fails (wrong or dead number) | Mark `unreachable` after retries, escalate to the booker, then the manager |
| E4 | Same number added twice | Rejected at entry by the unique index, with a clear message |
| E5 | Booker's own number given as a guest | Rejected the same way; the booker already has a contact |
| E6 | Guest submits after the cutoff | Accepted while the booking is in the future. Late is better than never; we simply stop chasing |
| E7 | A menu item is withdrawn after orders are in | Affected covers revert to incomplete, those contacts are re-chased, the manager is emailed |
| E8 | Booking moved to a date **outside** the period | **Needs a decision. See O2** |
| E9 | Booking moved to a date inside the same period | Pre-orders survive, chase points recalculated |
| E10 | Two devices on the same link at once | Last write wins per cover; the page re-reads after submit |
| E11 | Party size changed to below the period's minimum | Existing period validation refuses the amendment; unchanged by this work |
| E12 | Period deactivated after bookings exist | Existing bookings keep their `booking_period_id` and their pre-orders. The endpoint hides the period from new bookings only |
| E13 | Guest opens a link for a cancelled booking | Plain "this booking has been cancelled" page, no data shown |
| E14 | Token guessed or shared | Tokens are hashed and random. A shared link exposes only that contact's own covers, which is the point of D11 |

### B.10 Data protection

Guest phone numbers are **third-party personal data supplied by someone else**. This is the highest
compliance risk in the spec.

- Lawful basis: legitimate interest in fulfilling a booking the data subject is attending, with the
  booker's confirmation of permission (D10) recorded as evidence: store the tick with a timestamp.
- Every message identifies the pub and the booking, so nobody receives an unexplained text.
- Guest numbers are **not** added to `customers` and never enter marketing audiences.
- Retention: delete `phone_e164` from `booking_preorder_contacts` 90 days after the booking date, via
  the existing GDPR cleanup cron (see Open Question O5). Selections may be kept (they are food choices, not identifiers)
  provided `guest_name` is cleared with the number.
- Subject access and erasure: a guest contact must be findable by phone number and erasable.

### B.11 Cost

A party of twenty could be four contacts or twenty. Worst case is twenty contacts times four messages,
so eighty SMS for one booking. Recommendation: cap additional contacts at the party size, warn the
booker in the UI that each person will be texted, and add the SMS count for seasonal chases to the
existing SMS rate-limit monitoring.

---

## Part C. Automatic deposit refund on amendment (D2)

The owner rejected keeping this manual, so shrinking a party refunds the difference automatically.

**Re-price from the booking's own snapshot, never from the live period row.** The booking stores
`deposit_rule`, `deposit_basis`, `deposit_rate` and `deposit_amount`. Reading the current
`booking_periods` row instead would price the guest against terms a manager may have edited since
they booked. This is the specific trap that made the original reviewer leave the path manual, and the
snapshot is what makes it safe.

Rules:

1. Recompute the owed deposit from the snapshot's basis and rate at the new party size.
2. Refund `captured - owed` when positive. Never refund more than was captured, and never below zero.
3. If the booking is `pending_payment` and nothing was captured, reduce the amount owed. Do not
   attempt a refund.
4. Growing a party increases the amount owed. **Needs a decision. See O3.**
5. Every refund is idempotent, keyed on the amendment, and audit-logged.
6. A refund failure alerts the manager (Part D) and leaves the booking untouched rather than
   half-adjusted.

**Reviewer: the group rule interaction.** When the groups-of-ten rule beat the seasonal one, the
snapshot records the *group* basis and rate. Shrinking from twelve to eight may cross back below the
group threshold and change which rule applies. Recomputing from the snapshot's stored rule is correct
and predictable; recomputing which rule applies is not. State the intended behaviour explicitly in
the tests.

---

## Part D. Operational alerting (D3)

Email to `manager@the-anchor.pub`, batched every 15 minutes, one digest rather than one mail per
event. Watches, thresholds and reasoning are already specified in
`OJ-The-Anchor.pub/tasks/book-table-analytics-thresholds-2026-08-03.md` §Part 2, plus three new ones
from this spec: pre-order incomplete at cutoff (D7), refund failure (Part C), and withdrawn menu item
affecting live orders (E7).

---

## Part E. Merging the completed work, and retiring the four-step path (D4, D5)

D4 covers merging and deploying the branches already built (the seasonal question, the FOH screen,
the two defect fixes, the timezone work, the contract-fixture guard). That is finished work and is
not re-specified here; it simply ships. The rest of this part is the deletion.

The owner has waived the rollback, so this proceeds now.

**The removal list** is in `OJ-The-Anchor.pub/tasks/book-table-outstanding-work-2026-08-03.md` §W4 and
is precise: the `twoScreenFlow` prop and its 19 branches, the `choose` and `review` steps,
`handleContinueToReview`, `handleBackToFind`, `requestedTime`, `showAllTimes`, `slotWindowAnchorTime`,
`visibleSlots`, `hideHighChairPicker`, the `slotsStep` fork, the `journey.ts` step members,
`BookingProgressBar` defaults, `lib/table-booking-slot-window.ts`, the flag read in
`app/book-table/page.tsx`, `hideWhenNoHighChairFree`, and `coversHighChairRequest`. Fold in the dead
`kitchen_open` field at the same time.

**The real work is the tests, and it is larger than the deletion.**
`tests/unit/ManagementTableBookingForm.test.tsx` contains roughly 100 tests and **not one of them
renders the two-screen flow**. Verified: `grep -c twoScreenFlow` returns 0. Every test exercises the
path being deleted, while the flow that is actually live has no coverage in that file.

So deleting the old path without writing replacements first would delete the only tested flow and
leave the live one untested. Its idempotency-key, London-timezone, busyness, funnel-sequence,
stale-alternatives, food-check-notice, purpose-derivation and phone-privacy tests all describe
behaviour that is still live and must be rewritten against the two-screen flow **before** the old
code goes.

Sequence: write two-screen equivalents, prove them green, then delete. Not the other way round.

---

## 3. Testing

- Unit: completeness rules, chase-point calculation (including bookings made inside 7 days and a
  cutoff longer than 7 days), covers-sum invariant, shrink ordering, refund arithmetic from snapshot.
- Integration: full journey with two contacts, one completing and one going silent through every
  chase point to the manager email.
- Idempotency: run the chase cron twice over the same window and assert one message per contact.
- Data protection: retention cleanup clears numbers and names but keeps selections.
- Regression: the whole of Part E's rewritten two-screen suite.

## 4. Rollout

1. Migration (additive only: two tables, one nullable column on `booking_periods`, one `guest_tokens`
   change). No destructive statements.
2. AMS API and the guest page, inert while no period requires a pre-order.
3. Website booker UI.
4. Schedule the chase cron in `vercel.json`.
5. Only then publish the Christmas menu, which is what makes the period bookable.

Order matters: publishing the menu is the switch that turns the whole journey on, so it goes last.

## 5. Open questions for the reviewer

- **O1.** Nullable `guest_tokens.customer_id` plus `preorder_contact_id` (recommended), a customer
  record per guest, or a separate token table? This decides how third-party data is stored.
- **O2.** A booking moved to a date outside the period: refuse the move, or clear the pre-orders and
  re-price the deposit? Recommendation: refuse, and tell staff to cancel and rebook, because silently
  re-pricing a paid booking is worse than making someone do it deliberately.
- **O3.** Growing a party after a deposit was captured: take more money automatically, or invoice by
  payment link? Recommendation: payment link, because taking more money from a saved method without a
  fresh authorisation is a different consent question from refunding.
- **O4.** Is dessert genuinely required for every guest, or should the default required-course set be
  mains only? (§B.3)
- **O5.** Is the 90-day retention on guest numbers right for the pub's purposes? (§B.10)
