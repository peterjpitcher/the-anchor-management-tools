# Spec: change a parking booking's time and settle the money

Date: 24 November 2026
Status: READY TO BUILD. The owner confirmed all ten decisions in section 3 on 24 November 2026, and approved the customer text wording in section 8.1 as written on 24 November 2026 ("Approve as written"), so the texts go live with no off-switch.
Scope: the management app only (`OJ-AnchorManagementTools`). No code is written by this spec.

## 1. The problem

Staff cannot properly change the dates or times of a paid airport parking booking.

- A paid booking refuses any change to start, end or price ("Paid parking bookings cannot have price-affecting fields edited", `src/app/actions/parking.ts:534`). The only route today is refund, cancel and rebook by hand.
- An unpaid booking can be changed and is repriced, but the customer's payment link is retired and no new one is sent. The edit form has no "send payment link" option (it exists only on create). Staff must press the payment link button and send the link themselves.
- Worse, the reminder texts for an unpaid booking read the pending payment's link (`lookupPendingPaymentLink`, `src/app/api/cron/parking-notifications/route.ts:1003`). After a repriced edit there is no pending payment, so the reminder goes out saying "We'll text your payment link shortly" and nothing follows.
- Our own end-of-stay text tells customers "Need to extend? Give us a shout" (`src/lib/parking/notifications.ts`), and the website says a booking "can be changed or cancelled up to 24 hours before the booked arrival time" (website `docs/SSOT.md`, "Airport parking refunds", owner-confirmed 7 October 2026). The app cannot do either for a paid booking.

## 2. What we want

One action, "Change dates", on a parking booking. Staff pick the new start and end, see the old price, the new price and the difference, choose how the difference is settled, and save. The booking, the money and the customer message all follow from that one save.

Size of the problem, from production on 24 November 2026: 14 parking bookings ever, 9 paid, 1 live and in the future, no booking with more than one payment, and no parking refund ever recorded. So this must stay small, and the parking refund path has never run in production: test it for real before relying on it.

## 3. Decisions this spec is built on

The owner confirmed every row on 24 November 2026 ("Yes, all ten"). If a decision changes later, change it here and correct every section that depends on it. No separate addendum.

| # | Decision | What was decided | Status |
|---|---|---|---|
| D1 | Refund when the new stay costs less | Staff confirm it on the change screen: the refund amount is pre-filled with the difference and can be lowered, to zero if need be. It is sent when they save. Never sent without a person pressing save. | Confirmed by the owner, 24 November 2026 |
| D2 | Fee on a change refund | The pre-filled amount is the plain price difference. The "less the payment fee" rule in the website SSOT is written for cancellations; staff lower the figure by hand if they want to apply it. | Confirmed by the owner, 24 November 2026 |
| D3 | Inside 24 hours of arrival, or once the stay has started | The change is allowed. The screen warns that the published terms give no refund inside 24 hours, and pre-fills the refund at £0; staff may raise it up to the difference. | Confirmed by the owner, 24 November 2026 |
| D4 | When the new stay costs more | The new dates apply at once (the space is held) and the extra shows as owed. Staff choose one of: text a payment link (default), record it as paid at the venue, or waive it with a reason. | Confirmed by the owner, 24 November 2026 |
| D5 | If the extra is never paid | The booking stays confirmed. "£X to pay" shows on the booking, the parking list and the front-of-house parking view, so it is collected when the car is. No automatic chasing texts. | Confirmed by the owner, 24 November 2026 |
| D6 | Who can do it | Anyone with parking "manage" can change dates and collect extra. Sending a refund needs parking "refund". Without it the change saves and the booking shows the refund as still to do. | Confirmed by the owner, 24 November 2026 |
| D7 | Telling the customer | One text per change, stating the new dates and the money outcome, on by default with a switch to turn it off. Wording in section 8.1 approved as written. | Confirmed by the owner, 24 November 2026; wording approved the same day |
| D8 | Rate used | The whole stay is repriced at the rate in force today, as the edit already does for unpaid bookings. Only one rate has ever existed (from 3 October 2025). | Confirmed by the owner, 24 November 2026 |
| D9 | Who may change | Staff only. The customer cannot change their own booking online. | Confirmed by the owner, 24 November 2026 |
| D10 | A stay whose end has already passed | It can still be extended (a late collection) and the extra collected, for up to 7 days after the booked end. It cannot be shortened or refunded through Change dates once the end has passed; a refund after the fact stays a manager's decision through the Refund button. | Confirmed by the owner, 24 November 2026 |

## 4. Scope

In scope:

- A "Change dates" action for parking bookings that are `pending_payment` or `confirmed`.
- Repricing, the capacity check, refund of a difference, collection of a difference, and the customer message.
- The fixes needed so a booking can safely hold more than one payment (section 7).
- Sending a fresh payment link when an unpaid booking is changed, and stopping the "link shortly" reminder with no link.

Out of scope:

- Customer self-service changes (D9).
- Cancellation and its refund rule, which stay as they are.
- Applying the payment fee automatically.
- Changing the price rules or the rates.
- Any website change. The website only creates bookings and reads their state through this app's API. The builder must confirm that before release (section 12).

## 5. How the money is worked out

Add one pure module, `src/lib/parking/balance.ts`, and make it the only place that answers "what does this booking owe or is owed". Nothing is stored: the figures are derived from rows that already exist, so they cannot drift.

- **Price** = `override_price ?? calculated_price` on the booking.
- **Paid** = the sum of `amount` over the booking's `parking_booking_payments` rows with status `paid`.
- **Refunded** = the sum of `payment_refunds.amount` with `source_type = 'parking'`, `source_id` one of those payment rows, and status `completed` or `pending`. A pending refund counts as gone, so it is never sent twice.
- **Net paid** = Paid minus Refunded.
- **Balance** = Price minus Net paid, rounded to pence. Positive means the customer owes us ("£X to pay"). Negative means we owe them ("£X refund to do"). Zero is settled.

A booking that has never been paid (`payment_status = 'pending'`) keeps today's model: it owes the whole price and is not "confirmed with a balance".

The balance exists only for a live booking: status `confirmed`. A cancelled, expired or completed booking has no balance and shows none, whatever its rows add up to. Without this rule a cancelled and fully refunded booking would read as owing its whole price.

**The pending-payment rule.** After every change, and after every payment, refund, waiver or venue payment, this must hold for a confirmed booking: there is at most one pending payment row; if the balance is positive, that row (when it exists) is for exactly the balance; if the balance is zero or negative there is no pending row. Any pending row that breaks the rule is expired on the spot. A link already texted for an old amount must stop working: capture re-checks the row's amount against the balance at that moment and refuses (taking no money, since the order is only approved) when they differ or the row has been expired, sending the customer to the guest page, which shows what is owed now.

**An amount settled is settled.** When someone with the refund permission chooses a refund lower than the difference (including £0, the default inside 24 hours under D3), the rest is recorded as kept, not left as a refund to do: `override_price` is set to what the booking has then paid net, with the reason they typed. The balance is then zero. "Refund to do" appears only when nobody with the permission has decided yet.

No new booking or payment status is added. `payment_status` stays `paid` on a confirmed booking with a balance; the balance is what tells the screens something is outstanding. Every reader of `payment_status = 'paid'` is listed in section 9 with what it must show.

## 6. The change flow

### 6.1 The screen

On the booking detail in `src/app/(authenticated)/parking/_components/ParkingClient.tsx`, add "Change dates" beside "Edit". The existing Edit form keeps the customer, vehicle and notes fields; its start and end fields move to the new dialog so there is one way to change dates. Confirm `ParkingClient.tsx` is the file `parking/page.tsx` imports before touching it.

The dialog shows:

1. Current start and end, and new start and end. If the stay has started (`start_at` is in the past), the start is read-only and only the end can move.
2. Old price, new price and the difference, recalculated live through a server call (never priced in the browser).
3. One settlement block, depending on the difference:
   - **No difference:** "No money to settle."
   - **Costs less (paid booking):** "Refund", pre-filled per D1 to D3, editable from £0 to the difference, with a reason field. If the user lacks parking "refund", the block reads "A manager will need to send the refund of up to £X" and no amount can be entered.
   - **Costs more (paid booking):** three choices per D4: "Text a payment link", "Paid at the venue" (cash or card terminal), "No extra charge" (reason required, saved as an override price equal to what has been paid).
   - **Unpaid booking:** "Send the customer a new payment link" switch, on by default.
4. "Tell the customer" switch (D7), on by default, with a preview of the exact text.
5. The 24-hour warning from D3 when it applies.

A booking with an existing override price: the dialog says so ("This booking has an agreed price of £X"). A date change clears the old override and starts from the calculated price for the new dates. The settlement choice may then set a new override, in exactly two cases: "No extra charge", and a refund lowered below the difference (section 5, "An amount settled is settled"). Both record a reason.

When the choice is "Text a payment link" and the text cannot go (the customer has opted out, quiet hours hold it, a kill switch is on, or the send fails), the result screen shows the link with a copy button and says the customer has not been told.

### 6.2 The server action

New action `changeParkingBookingDates(bookingId, input)` in `src/app/actions/parking.ts`. Input: new start and end, the settlement choice, refund amount and reason, notify switch, and a `changeId` (a UUID made once per opening of the dialog). It follows the house pattern: Zod, `checkUserPermission('parking', 'manage')`, audit log, `revalidatePath('/parking')`, `revalidateTag('dashboard')`. A refund also checks `checkUserPermission('parking', 'refund')` on the server.

`updateParkingBookingDetails` keeps refusing date and price changes on a paid booking, with the message changed to point staff at "Change dates". For an unpaid booking it stops accepting date changes too, so there is one path.

Steps, in this order. The order matters: the space is claimed before any money moves.

1. Load the booking. Refuse if it is `cancelled`, `completed` or `expired`. Refuse if end is not after start. Refuse a start change on a stay that has started. For a stay whose booked end has passed (D10): allow only a later end, only within 7 days of the booked end, and refuse anything that lowers the price. Refuse if the booking has changed since the dialog loaded (compare `updated_at`), so two people cannot settle the same difference twice.
2. Reprice with `calculateParkingPricing` and the active rate (D8). Work out the balance the booking will have after the change (section 5).
3. Check the settlement choice matches the difference the server calculated. If the screen and the server disagree on the amount, refuse and show the new figures. Never trust an amount from the browser beyond "refund at most this much".
4. **Save the booking**: start, end, duration, calculated price, pricing breakdown, override, `updated_by`. The capacity trigger `enforce_parking_capacity` runs here: a stay that stays inside its old dates passes untouched; a longer or moved stay must find a free space or the save fails with the existing "No parking spaces remaining" message (`parkingCapacityRefusal`). If the save fails, stop. Nothing else has happened.
5. Reset reminder flags for the dates that moved (section 8.2).
6. **Settle the money** (6.3 to 6.5).
7. **Tell the customer** if the switch is on (section 8).
8. Write the audit log: old and new dates, old and new price, the difference, the settlement choice and its outcome, `changeId`.

Steps 6 and 7 can fail after step 4 has succeeded. The dates are never rolled back. The action returns `{ success: true, warning }` with a plain message saying what did not happen and what to do, shown as a long-lived error toast, and the booking keeps showing its balance until it is settled. A failed step must never read as a failed change, or staff will do the change twice.

### 6.3 Unpaid booking

- Retire the pending payment row when the amount changed (as today: status `expired`, metadata kept and marked superseded).
- If "send a new payment link" is on: make a new order at the new price with `createParkingPaymentOrder` and send it with `sendParkingPaymentRequest`. If the link cannot be made or the text cannot be sent, return the warning described above. Do not reset the offer deadline unless it has already passed (the existing rule in `generateParkingPaymentLink`).
- If the switch is off: still make the new order, so the reminder texts have a real link to carry.
- Separately, fix the reminder cron: when `lookupPendingPaymentLink` finds no link, it makes one (or skips the text and counts it as an error). It never sends "We'll text your payment link shortly".

### 6.4 Paid booking, costs less (a refund)

- With parking "refund" and an amount above zero: send the refund through the existing shared refund code (`processPayPalRefund` for PayPal payments, `processManualRefund` for a payment recorded as cash or card). Never call PayPal directly, and never use the private `refundParkingPayment` in `src/lib/parking/payments.ts`: it writes no refund record and cancels the booking. It has no callers; delete it in this change.
- Which payment the money comes off: newest paid payment first, each capped at what is still refundable on it, moving to the next if the amount is larger. In practice this is one payment unless the booking was extended earlier.
- A PayPal payment older than 180 days cannot be refunded by PayPal (`PAYPAL_REFUND_WINDOW_DAYS`). The dialog then offers only "Refund by cash or bank transfer", recorded through `processManualRefund`.
- The refund request must be keyed on `changeId` plus the payment id, so a double click or a retry replays the same refund and moves no more money. The builder checks whether `processPayPalRefund` already accepts a caller's key; if not, add it as an optional parameter and leave every other caller unchanged.
- The shared refund code sends the customer its own refund message. For a refund made as part of a date change that message must be suppressed, because the change text (section 8) already says the amount. Add an option to skip the notification and record `notification_status = 'skipped'`. One change, one message.
- With the permission and an amount below the difference (including zero): send what was chosen, if anything, and record the rest as kept (section 5). The booking is settled.
- Without the permission: nothing is sent. The booking shows "£X refund to do" and the existing Refund button, for someone who has the permission, opens with that amount pre-filled and a "No refund due" choice with a reason, which settles it the same way.

### 6.5 Paid booking, costs more (extra to collect)

- **Text a payment link:** make a PayPal order for the balance only (not the whole price), insert a pending payment row with `metadata.purpose = 'top_up'`, and text the link in the change message. The unique index `parking_booking_payments_unique_pending` allows one pending row per booking, which is what we want: a second change replaces the pending top-up with one for the new balance.
- **Paid at the venue:** insert a payment row for the balance with `provider = 'manual'`, status `paid`, and the method (cash or card terminal) and the user in metadata. No PayPal call.
- **No extra charge:** set `override_price` to net paid, with the reason. The balance becomes zero.
- The booking stays `confirmed` and `payment_status = 'paid'` throughout (D4, D5). A top-up that is never paid changes nothing else; the balance simply keeps showing. The payment-lifecycle cron only touches `pending_payment` bookings, so it will not expire the booking. Add a test that says so.
- The PayPal order behind a top-up link can lapse, and the reconciliation cron expires pending rows whose order has gone. That is safe here because the debt is the balance, not the row: the balance still shows, and "Send payment link" on the booking makes a fresh order for whatever is then owed.

## 7. Making more than one payment per booking safe

Today every part of parking assumes one payment per booking. Phase 2 creates a second one, so these must all be fixed first, each with a test. This is the riskiest part of the work.

| Where | Today | Required |
|---|---|---|
| `createParkingPaymentOrder`, `src/lib/parking/payments.ts:67` | Charges the whole booking price; reuses any pending row. | Takes the amount to charge. For an unpaid booking that is the price; for a confirmed one it is the balance. Reuses a pending row only if its amount matches, otherwise expires it and makes a new one. |
| `generateParkingPaymentLink`, `src/app/actions/parking.ts:787` | When `payment_due_at` is missing or past it resets the booking to `pending_payment` and `pending` with a new 7-day deadline. On a confirmed booking with a balance that would un-confirm it, and the lifecycle cron would then send "offer expires" texts and expire it. `createParkingPaymentOrder` also throws without `payment_due_at` and copies it to the row's `expires_at`. | For a confirmed booking it never touches the booking's status, payment status or deadline. It makes an order for the balance. The top-up row's `expires_at` is the booking's `end_at`. The builder must list everything that reads a payment row's `expires_at` and confirm none of it can expire or cancel the booking. |
| `captureParkingPayment`, `payments.ts:339` | Returns early if the booking is already paid and confirmed; otherwise confirms the booking, resets both three-day reminder flags and sends "your parking is now confirmed". | If the booking is already confirmed and the order belongs to a pending top-up: capture it, mark that row paid, leave the booking's status and reminder flags alone, and send the top-up receipt wording (section 8), not the confirmation. |
| Return route, `src/app/api/parking/payment/return/route.ts:31` | Redirects to "success" without capturing when the booking is paid and confirmed. | Only short-circuits when there is no pending payment for the returned order. Otherwise it captures the top-up. |
| Retry route, `src/app/api/parking/payment/retry/route.ts:36` | Refuses when the booking is paid and confirmed. | Allows a confirmed booking with a positive balance, and charges the balance. |
| Website capture route, `src/app/api/parking/payment/capture/route.ts:45` | Same short-circuit. | Left as it is: the website only pays for new bookings. State that in a comment. |
| Webhook handler, `src/lib/paypal-domains/parking.ts:22` | Picks the booking's newest payment row and throws if the amount differs. A late event for the first payment, arriving after a top-up row exists, would mismatch and throw. | Finds the row by the PayPal order or capture id on the event. If none matches, log it and acknowledge; never throw for an event it cannot place. It must not move a confirmed booking's status. |
| `updateRefundStatus`, `src/app/actions/refundActions.ts:398` | Cancels the booking as soon as one payment row is fully refunded. With two payments, refunding the top-up in full would cancel a live booking. | The booking is cancelled and marked `refunded` only when the refunds across all its paid payments reach the total paid across them. Each row's own `refund_status` stays per row. |
| `getParkingPaymentForRefund`, `refundActions.ts:1007` | Returns the newest paid payment only. | Returns every paid payment with what is still refundable on each, and the refund dialog lets staff refund across them (newest first by default). |
| `markParkingBookingPaid`, `src/app/actions/parking.ts:866` | Overwrites the booking's newest payment row, whatever its state, with the full price. On a topped-up booking that would rewrite a paid row. | Acts only on a pending row, or inserts a new one, and for the amount actually outstanding. |
| Guest page, `src/app/parking/guest/[id]/` | Shows "Pay now" only for an unpaid booking. | For a confirmed booking with a positive balance, shows the new dates, "£X still to pay" and "Pay now". The public projection stays an explicit allow-list; add only the balance figure, worked out on the server. |
| Reconciliation cron, `src/app/api/cron/parking-paypal-reconciliation/route.ts` | Records a capture PayPal took that we missed, and confirms the booking. | For a top-up it records the payment and leaves the booking's status alone. |

## 8. Customer messages

Parking messages are texts today, sent through `sendSMS` with the parking eligibility check, quiet hours and the kill switches. Keep that. Never bypass them: a change made at 22:00 queues or skips the text exactly as the existing parking texts do, and the dialog says which.

### 8.1 Wording (approved by the owner as written, 24 November 2026)

The owner approved these words as written on 24 November 2026, so the change texts ship live with no extra messaging switch. The usual SMS kill switches, opt-outs and quiet hours still apply.

Dates are formatted with `formatDateTime` from `dateUtils`, as every other parking text is. If that format names a weekday, the weekday must come from the date in London time, never typed. Amounts come from the server's figures.

- Change, nothing to pay or refund: "The Anchor: Hi {first name}, your parking is now {start} to {end}. Any questions, call {number}."
- Change with a refund: "The Anchor: Hi {first name}, your parking is now {start} to {end}. We are refunding £{amount} to the way you paid. Any questions, call {number}."
- Change with extra to pay by link: "The Anchor: Hi {first name}, your parking is now {start} to {end}. There is £{amount} extra to pay: {link}. Any questions, call {number}."
- Change with extra paid at the venue: "The Anchor: Hi {first name}, your parking is now {start} to {end}. Thanks for the £{amount} you paid today."
- Top-up paid online: "The Anchor: Hi {first name}, thanks, we have your £{amount}. Your parking is {start} to {end}."

Builders in `src/lib/parking/notifications.ts`, typed against `ParkingNotificationBooking` so a missing column is a compile error. Each template gets a render test with fixture data that fails on `undefined`, `Invalid Date`, `NaN` and `£0.00`. Keep every text inside one SMS segment where possible: plain apostrophes only, no curly quotes.

### 8.2 Reminder flags

When the start moves, clear `paid_start_three_day_sms_sent` and `start_notification_sent` only if the new start is more than three days away. When the end moves, the same for `paid_end_three_day_sms_sent` and `end_notification_sent`. Inside three days the change text has just told them, so the flag stays set and no second text follows. The builder must read the cron's windows and confirm no change can make it send a reminder in the same hour as the change text.

### 8.3 Logging

Each message is logged in `parking_booking_notifications`. Its `event_type` is the enum `parking_notification_event`, which has no value for a change. Add `booking_changed` and `top_up_received` (section 10).

## 9. What each screen and job shows when a balance is outstanding

| Reader | Required behaviour |
|---|---|
| Parking list and detail (`ParkingClient.tsx`, `listParkingBookings`) | The list query returns the balance for each booking. A badge "£X to pay" or "£X refund to do" sits beside the payment badge. The detail shows price, paid, refunded and balance. |
| Refund button (`ParkingClient.tsx:874`) | Still shown for a paid booking. Opens pre-filled with the refund to do, if there is one. |
| "Send payment link" and "Mark paid" | Shown for a confirmed booking with a positive balance, acting on the balance. |
| Front-of-house parking view (`src/lib/foh/parking-view.ts:77`, `paid: row.payment_status === 'paid'`) | Adds an "owes £X" flag so the till sees it when the car is collected. No customer contact details are added to that view. |
| Outstanding counts (`src/actions/get-outstanding-counts.ts`) | Counts a confirmed booking with any non-zero balance as needing attention. |
| Session reminder cron (`parking-notifications/route.ts:722`) | Unchanged: a confirmed, paid booking still gets its start and end texts whatever its balance. |
| Online income (`online_income_movements` view) | No change needed. It already lists each PayPal payment row with its own refunds, so a top-up appears as its own line. Venue-paid top-ups have `provider = 'manual'` and stay out, as manual payments do today. Check the page after release. |
| Insights and customer pages | Read the price and status only. Confirm nothing sums payment rows in a way a second row would double. |

## 10. Database

One small migration, additive and backwards compatible, applied before the code deploys:

- `ALTER TYPE parking_notification_event ADD VALUE IF NOT EXISTS 'booking_changed'` and the same for `'top_up_received'`. A new enum value cannot be used in the transaction that adds it, so the migration only adds them.

In the same change, add both values to the hand-written `event_type` union in `src/types/parking.ts` and to the notification label map in `ParkingClient.tsx`, or the notification history shows a blank label.

No new table or column. Top-ups are ordinary `parking_booking_payments` rows marked in `metadata`; balances are derived. Regenerate `src/types/database.generated.ts` in the same change. No new table, view or `SECURITY DEFINER` routine, so the anon-surface check is not triggered, but run it anyway.

The capacity trigger needs no change. Verified on production, 24 November 2026: an update that keeps the stay inside its old dates claims nothing; any other date change takes the advisory lock and must find a space, ignoring the booking itself. `capacity_override` still bypasses it and stays in the Edit form.

## 11. Delivery in two phases

Each phase is deployable alone.

**Phase 1: changes that never create a second payment.**

- `balance.ts`, and the balance shown on the list, detail and front-of-house view.
- "Change dates" for unpaid bookings (new link sent, reminder fix) and for paid bookings where the new price is the same or lower (refund).
- A paid booking whose new price is higher is refused with: "This change costs £X more. Extending a paid booking is not available yet."
- The refund message suppression, the `changeId` key, the delete of `refundParkingPayment`, the `booking_changed` enum value and the wording for the first two templates.

**Phase 2: extra owed on a paid booking.**

- Everything in section 7, then the three "costs more" choices, the guest page change and the remaining templates.

## 12. Tests and checks

Tests live under `tests/` mirroring `src/`. Both `npm test` (London) and `npm run test:utc` must pass.

- `balance.ts`: unpaid, paid in full, part refunded, pending refund counted, two payments, overpaid, override price.
- Pricing examples below, run through the real `calculateParkingPricing`, including one stay that crosses a clock change (for example 27 March 2027 to 29 March 2027) priced the same under both zones.
- The action: every refusal in 6.2 step 1; the save refused by the capacity trigger moves no money and sends nothing; a stale `updated_at` is refused.
- Failing dependencies, one test each, asserting staff see the warning and the booking still shows its balance: PayPal refund fails, PayPal order creation fails, the text fails, the text is held by quiet hours or a kill switch.
- A literal second run: the same `changeId` submitted twice sends one refund and one text.
- Section 7, one test per row. In particular: refunding a top-up in full does not cancel the booking; a late webhook for the first payment after a top-up exists is acknowledged and changes nothing; Mark Paid never rewrites a paid row; an unpaid top-up never expires the booking.
- Template render tests (8.1).
- A render test of the new dialog, and a check that the Edit form still saves name, vehicle and notes on a paid booking.
- `npm run mcp:manifest` and commit `src/lib/mcp/generated/` (new action, changed parameters). Check the new action is classed as a write. Give it a doc comment: agents read it.
- Lint, `npx tsc --noEmit`, `npm run typecheck:tests`, an uncached build.
- Website check (paired repositories rule): grep `OJ-The-Anchor.pub` for calls to `/api/parking/` and confirm it only creates bookings, captures the first payment and reads state, so nothing there needs to change. Say so in the PR.
- After release, on production: change the dates of a real unpaid test booking and of a paid one, with a refund of a small amount, and read the PayPal refund, the `payment_refunds` row, the text and the list page. The parking refund path has never run in production. This check moves real money and sends a real text, so the owner must approve it by name (which booking, what amount) before it is run.
- The pending-payment rule in section 5: a top-up link texted for £30 cannot be paid after the debt was paid at the venue, waived, or changed to a different amount.
- A cancelled, fully refunded booking shows no balance.
- "Send payment link" on a confirmed booking with a balance leaves it confirmed, and the lifecycle cron run straight afterwards sends nothing and expires nothing.
- D10: a stay past its end can be extended within 7 days and not shortened.

## 13. Worked examples

Prices from the live rate (£5 an hour, £15 a day, £75 a week, £265 a month), produced by running `calculateParkingPricing` on 24 November 2026:

| Stay | Price |
|---|---|
| 4 days | £60 |
| 5 days | £75 |
| 6 days | £75 |
| 7 days | £75 |
| 7 days and 3 hours | £90 |
| 9 days | £105 |

Note the trap: shortening a 7-day stay to 5 or 6 days costs the same, because the weekly rate is cheaper than five daily ones. The screen must say "No money to settle" there, not offer a refund.

**A. A stay under way, extended, paid by link.** Paid £75 for 7 days; the car is already here. The customer rings to add two days. Staff open Change dates: start is locked, end moves out two days, new price £105, difference £30. They choose "Text a payment link". Save: the trigger finds a space for the two extra days; the booking stays confirmed; a pending £30 top-up row is made; the customer gets the change text with the link. The booking shows "£30 to pay" on the list and the front-of-house view. The customer pays: the return route captures the top-up, the row turns paid, the balance is zero, the booking's status and reminder flags are untouched, and the customer gets the top-up receipt text, not a second "confirmed". If the customer never pays, the booking stays confirmed and "£30 to pay" stays visible at collection. If the end-of-stay reminder flag was already set and the new end is inside three days, no second reminder goes out.

**B. A shortened stay whose refund fails.** Paid £105 for 9 days, arrival a week away. The customer shortens to 4 days: new price £60, refund pre-filled at £45. Staff save. The dates and price are saved first. PayPal then rejects the refund. The action returns success with the warning "The dates were changed, but the £45 refund did not go through. Nothing was sent to the customer about a refund." The customer gets the plain change wording, with no refund sentence: the refund sentence is only ever sent for a refund that PayPal accepted. The booking shows "£45 refund to do"; the freed days are back on sale; a manager retries from the Refund button. A retry of the same save with the same `changeId` does not send two refunds.

**C. A topped-up booking later cancelled in full.** Booking A above, now with two paid payments (£75 and £30). The customer cancels well ahead. Staff cancel it (unchanged flow: cancelling is not refunding) and open Refund, which lists both payments with £75 and £30 refundable. Refunding only the £30 leaves the booking's money state as part refunded; under today's code it would have marked the booking refunded and cancelled on that one row. Refunding both reaches the total paid, and only then is the booking marked `refunded`. Online income shows two lines, each with its own refund.

## 14. Assumptions the builder must verify, not trust

- That `processPayPalRefund` can take a caller's request key and a "skip the customer message" option without changing behaviour for table and private bookings.
- That nothing outside the files in section 7 reads a parking booking's payments assuming one row (grep `parking_booking_payments` in `src/`, `scripts/` and `tests/`).
- That `formatDateTime` output and the text lengths fit one SMS segment for a typical stay.
- That the website needs no change.
