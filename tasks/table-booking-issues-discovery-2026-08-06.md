# Table booking issues: discovery, 2026-08-06

Four issues raised by the owner. Two repos in scope:

- AMS: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools` (main `2a9e36ed`)
- Website: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub` (main `6c1b1e1c`)

Everything below was checked against the live production database
(`tfcasgxopxegwrabvwat`) and the real source. No code has been changed.

---

## Issue 1: late cancellation fees

### What the guest is told today

Three places, all in AMS, all on the guest self-service page reached from the
"manage your booking" link:

| File | Line | Copy |
|---|---|---|
| `src/components/features/shared/GuestCancelBooking.tsx` | 46 | "Cancelling within 24 hours of your booking may incur a late-cancellation fee." |
| `src/components/features/shared/GuestCancelBooking.tsx` | 59 | "This cannot be undone. Cancelling within 24 hours may incur a fee." |
| `src/app/g/[token]/table-manage/page.tsx` | 116 | "Booking cancelled. A late-cancellation fee may apply." |

A fourth, same class, for party-size reductions rather than cancellations:

| File | Line | Copy |
|---|---|---|
| `src/app/g/[token]/table-manage/page.tsx` | 114 | "Booking updated. A fee may apply for reducing your party size." |

The website carries no fee copy at all. The booking SMS templates carry none
either (`table_booking_sms_templates` was checked in full). So the guest only
ever meets this language on the AMS-hosted manage page.

### What happens behind it

`src/lib/table-bookings/manage-booking.ts:632-644` creates a `charge_requests`
row of type `late_cancel` whenever a guest cancels inside the fee window, then
calls `createSystemChargeRequestWithApproval`, which emails the manager
(`src/lib/table-bookings/manage-booking.ts:337-341`).

The email goes to `MANAGER_APPROVAL_EMAIL`, defaulting to `manager@the-anchor.pub`
(`src/lib/table-bookings/charge-approvals.ts:8`). It contains a tokenised link to
`/m/<token>/charge-request`, where a manager can approve or waive.

Approving calls `attemptApprovedChargeFromDecision`, which needs
`stripe_customer_id` and a saved payment method. Without both it writes a failed
payment row with the reason "No card on file for this booking"
(`charge-approvals.ts:404-460`).

### Production evidence

```
charge_requests, all time:
  late_cancel   / system / pending  : 21 rows, GBP 1,020.00, 2026-06-20 to 2026-08-06
  no_show       / foh    / pending  :  4 rows, GBP   210.00, 2026-02-22 to 2026-04-01
  reduction_fee / system / pending  :  2 rows, GBP    75.00, 2026-03-15 to 2026-06-21
  no_show       / foh    / waived   :  1 row,  GBP    45.00, 2026-03-14

charge_requests with charge_status = 'succeeded' : 0
customers with a stripe_customer_id              : 0
```

The owner is right. No card is held for any customer, so no charge has ever
succeeded or ever could. Every one of those 21 late-cancel emails asked a manager
to approve something the system cannot collect. The most recent fired this
morning, 2026-08-06 05:50.

There is also no card capture anywhere in the schema: the only Stripe columns in
the database are `customers.stripe_customer_id`, `charge_requests.stripe_payment_intent_id`
and two on `payments`. There is no stored payment method column at all.

### Scope note

The same machinery drives three other charge types. Two matter here:

- `reduction_fee` fires automatically at the guest, exactly like `late_cancel`,
  and is equally uncollectable. Same defect, same code, 2 rows.
- `no_show` and `walkout` are raised by hand by FOH staff from the booking screen
  (`src/lib/foh/bookings.ts:105-230`). A person chooses to press those. They are
  also uncollectable, but they are rare and deliberate.

Decision needed, see the questions at the end.

---

## Issue 2: confirmation page loads at the bottom

### Root cause

`components/features/TableBooking/ManagementTableBookingForm.tsx:1985-1995`
returns the confirmation card early, before the wizard container is rendered:

```tsx
if (result?.state === 'confirmed') {
  return <BookingConfirmedCard ... />
}

return (
  <div ref={wizardRef} className="mx-auto max-w-[640px]">
```

The only scroll-to-top in the form is keyed to a step change and scrolls
`wizardRef`:

```tsx
useEffect(() => {
  if (!wizardMountedRef.current) { wizardMountedRef.current = true; return }
  wizardRef.current?.scrollIntoView({ block: 'start' })
}, [step])          // line 668-674
```

Confirming a booking changes `result`, not `step`. So the effect never runs, and
by the time it could, `wizardRef` has unmounted along with the wizard. The
browser keeps the scroll position the guest had at the Confirm button, which sits
at the bottom of a long review screen. The confirmation card that replaces it is
short, so the guest lands on the content below the form: the "prefer to talk to
us" line, the opening-hours sidebar and the page footer
(`app/book-table/page.tsx:192-230`).

### Second surface, same bug

The deposit path for groups of 10 or more has its own confirmation, an
in-wizard success alert set by `setPaymentState('confirmed')`
(lines 1427 and 1350). That one is inside the wizard container, but it is still
not a `step` change, so it also does not scroll. Worth fixing in the same pass.

---

## Issue 3: do we hold an inside table for outside bookings?

**No. We never have.**

The copy, `components/features/TableBooking/TableRefinements.tsx:90-93`:

> **Outside table, weather permitting**
> The garden if the weather holds, and a table inside if it does not.

What actually happens:

- `is_outside_seating` is a column on `table_bookings`, not on `tables`. Outside
  is a property of the booking.
- An outside booking is deliberately skipped by inside table allocation. It never
  gets a `booking_table_assignments` row and never lands in the unassigned strip
  (`src/app/api/foh/schedule/route.ts:826`). A database constraint forbids
  pinning one to a table at all
  (`supabase/migrations/20260801000200_booking_allocation_columns.sql:64`).
- What it does hold is a garden table, recorded in `outside_reservations`, kept in
  step by the reconciler added in
  `supabase/migrations/20260802000008_outside_reservation_sync.sql`.

Production check, all 23 outside bookings on record, every one in the last 180
days:

```
outside_bookings          : 23
outside_with_inside_table :  0
```

So the second half of that sentence is a promise the system does not keep. If it
rains, the guest arrives holding a garden reservation and nothing else, and the
inside tables have been sold to other people. Staff have to improvise.

The rest of the copy is accurate.

---

## Issue 4: "just drinks" claims it reveals kitchen-closed times

### The copy

`components/features/TableBooking/TableRefinements.tsx:75-78`:

> **Just drinks, no food**
> We will seat you in the bar and show times when the kitchen is closed too.

The same sentence exists a second time at
`ManagementTableBookingForm.tsx:2529-2532`, in the legacy four-step branch.
Both branches live in the tree. The two-screen flow is the live one: the AMS
runtime flag `website_ui_flags.booking_options_step1` is `true`, set 2026-08-01,
which makes `TableRefinements.tsx` the component guests actually see
(`app/book-table/page.tsx:85-92`). The legacy copy still needs fixing, because
turning the flag off is a settings change and would put it straight back in front
of guests.

### The owner is right, and the second clause is simply false

`app/api/table-bookings/availability/route.ts:204-210` asks AMS two questions
in parallel, and the **drinks** answer always decides which times exist:

> The pub is open for drinks whenever it is open at all, so the DRINKS answer is
> the superset and decides which times exist. The FOOD answer is a subset of it
> and only refines the "Drinks & food" versus "Drinks only" label.

Ticking the box does not add a single slot. It only stops the food call being
made. The grid is identical either way, and every slot already carries its own
caption, "Drinks & food" or "Drinks only"
(`components/features/TableBooking/SlotPickerGrid.tsx:62`).

The first clause is true. Ticking it does change real behaviour on the AMS side:
the booking is submitted as `purpose: 'drinks'`, which puts the house order in
the bar, shortens the turn, and drops the booking out of kitchen pacing
(`src/lib/table-bookings/kitchen-pacing.ts:124`).

### Why the times are shown to everyone on purpose

Restricting the grid to kitchen hours for guests who have not ticked the box was
tried and is documented as a production defect
(`app/api/table-bookings/availability/route.ts:190-199`). On a Monday the kitchen
is closed all day, so the food answer is zero slots while the drinks answer is 23
slots between 16:00 and 21:30. Every Monday would have told guests the pub was
shut on a day it was open and serving. Every other night the food answer stops
one to three hours before the bar does, so all the late drinks slots would have
gone too.

---

## Complexity

| Issue | Files | Schema | Score |
|---|---|---|---|
| 1. Late cancellation fees | 3 to 4 AMS | none | 2 (S) |
| 2. Confirmation scroll | 1 website | none | 1 (XS) |
| 3. Outside seating copy | 1 to 2 website | none | 1 (XS) |
| 4. Drinks toggle copy | 2 website | none | 1 (XS) |

All four are copy or small behaviour changes. No migration is required for any of
them. Nothing here is destructive.

---

## Decisions needed

1. **Late cancellation, how far to go.** Recommendation: remove the late-cancel
   charge request and its manager email entirely, and do the same for the
   automatic party-size `reduction_fee`, since it fires at the guest with no human
   involved and is equally uncollectable. Leave the FOH no-show and walkout
   buttons alone for now, because a person chooses to press those.
2. **The 21 pending late-cancel rows in production.** Recommendation: leave them.
   They are an audit record, all pending, none charged, and their approval links
   expire on their own.
3. **Outside seating wording.** Recommendation: replace with what is true, for
   example "We will reserve you a table in the garden. If the weather turns we
   will find you a spot inside if we can, so it is worth ringing us on the day."
4. **Drinks toggle wording.** Recommendation: replace the second clause, for
   example "We will seat you in the bar, and your table will not be held for
   food." Keep the grid behaviour exactly as it is.

**All four were approved by the owner on 2026-08-06, built and SHIPPED TO
PRODUCTION the same day.**

- AMS: commit `d5fd8f48`, deployed under `9432714b`, Vercel commit status
  success, aliased to management.orangejelly.co.uk.
- Website: commit `b996a4b4` on main, deployment `the-anchor-ecdcq9kve` Ready
  and aliased to the-anchor.pub.

Full pipeline green on both before pushing: typecheck, lint, 4571 AMS tests,
1279 website tests, cold production builds. Both corrected sentences were then
verified against the live production DOM: the two false claims are absent, the
new copy is present, and the word "fee" appears nowhere in the booking options.

---

## Issue 5: review-request SMS and bookings not marked as left

Raised after the four above: "clean up any tables that haven't been marked as
left at the end of each day so they get their sms message asking for a review."

### The premise does not hold. `left_at` has nothing to do with it.

The table-booking review request is real and working. It is sent by
`src/app/api/cron/event-guest-engagement/route.ts`, which Vercel runs every 15
minutes. Email first where there is a usable address, SMS otherwise.

Its eligibility test, `route.ts:1335-1340`:

```ts
if (booking.status !== 'confirmed' || booking.review_sms_sent_at) return false
return now >= startMs + 4 * 60 * 60 * 1000 && now - startMs <= maxAgeMs   // 7 days
```

So a booking qualifies when it is still `confirmed`, four hours after it started,
inside a seven-day window. `left_at` is not read, here or anywhere in the sweep.

Marking a table as left does not touch `status` at all. The route
(`src/app/api/foh/bookings/[id]/left/route.ts:47-52`) writes `left_at`,
`end_datetime` and `updated_at`, nothing else.

**A booking that was never marked as left is therefore already eligible**, and
gets its review request exactly like any other. There is nothing to release.

### Production evidence

Past bookings still sitting at `confirmed` with no review sent and no suppression:

```
within the 7-day window (may still fire)   : 9    (1 not marked left, 8 marked left)
older than 7 days (permanently missed)     : 221  (133 not marked left, 88 marked left)
```

Being marked as left made no difference either way: 88 of the missed ones had
been marked left and 133 had not.

Why the 221 were missed:

```
no usable contact channel (no active mobile, no usable email) : 187
contactable, genuinely missed                                 :  34
```

All 34 contactable ones fall in August to December 2025, before the review
feature existed. The earliest review message in production is 2026-04-05. Since
the feature went live, **no contactable guest has been missed**.

### What is actually worth doing

One narrow gap, and it is housekeeping rather than lost reviews. When the sweep
skips a booking because the customer has no usable contact channel, it increments
`result.skipped` and moves on without writing `review_suppressed_at`. Those rows
are therefore re-evaluated every 15 minutes for seven days, then age out of the
window and sit at `confirmed` forever. That is the pile-up the owner has noticed.

Writing the suppression flag in that branch closes them out properly. It changes
no guest-facing behaviour and cannot change how many reviews are requested.

**What must NOT be built: an end-of-day sweep that moves bookings out of
`confirmed`.** Review eligibility depends on the booking still being `confirmed`
four hours after it started. A 9pm table does not become eligible until 1am, so
any overnight sweep would race the delay and silently cancel that guest's review
request. This is the exact opposite of the intent.

### Decision needed

5. Nothing is currently being missed, so do you want the housekeeping change
   (flag bookings that have no contactable customer as suppressed, so they stop
   accumulating at `confirmed`)? Recommendation: yes, it is small and safe, but
   it will not produce a single extra review.
