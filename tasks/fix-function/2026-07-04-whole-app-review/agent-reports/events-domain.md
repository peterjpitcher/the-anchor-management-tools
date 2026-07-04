# Events Domain Deep Review — HEAD 76655f69 (2026-07-04)

Scope: multi-ticket-types (flag ON), attendee names, manager refunds + async PayPal reconciliation, check-in kiosk, booking counts, door-list/email breakdowns. Staff UI (`EventDetailClient`), actions (`events.ts`, `eventTicketTypes.ts`, `event-check-in.ts`), service (`event-bookings.ts`), libs (`ticket-types*`, `manage-booking.ts`, `event-payments.ts`, `refund-*`), public API + PayPal webhook + crons, and migrations `20260720–20260722`.

**Verified sound (no findings):** no legacy "credit card hold" language anywhere in events; £10/group-deposit rule N/A (events are venue-hosted → exempt); refund permission gate (`manager`/`super_admin`, shared `manager@` excluded) is correct and pure (`refund-permissions.ts:19-27`); public booking API idempotency incl. fail-closed on persist failure (`api/event-bookings/route.ts:426-458`); PayPal capture amount/custom-id matching (`event-payments.ts:678-683`); refund reconciliation is concurrency-safe pending→terminal (`refund-reconciliation.ts:58-80`); webhook signature + idempotency (`webhooks/paypal/event-bookings/route.ts:111-137`); multi-type breakdowns in confirmation email, door-list PDF and staff table correctly gated; kiosk page enforces `events:manage` server-side (`(event-kiosk)/events/[id]/check-in/page.tsx:25-36`) and all three kiosk actions re-check it (`event-check-in.ts:166-180`); "Turnstile skip when API key present" is not a bypass (garbage auth header still 401s in `withApiAuth`).

---

## High

**EV-01 — Manager's refund decision is silently dropped when cancel follow-ups fail (paid customer, no refund, no notification, no audit).**
`src/app/actions/events.ts:1488-1649`. The booking is set `cancelled` first; if the hold-release/table-cancel follow-ups fail (lines 1611-1649) the action returns an error **before** `processEventRefund` (1656), the cancellation SMS (1692+), the cancelled email (1753) and the audit log (1761) ever run. Retrying hits the `already_cancelled` early-return (1420-1432), which has no refund path — so the refund the manager approved is permanently lost unless someone notices in PayPal. Impact: customer charged for a cancelled booking; no record that a refund was intended. Fix: process the refund (idempotency key already exists: `staff-cancel-refund:${bookingId}`) and send notifications even when follow-ups fail, returning a warning instead of aborting; or make `already_cancelled` re-run the refund decision.

**EV-02 — Staff "Cash/Card paid" records the wrong amount for multi-ticket-type bookings (and applies the online discount to door payments).**
`src/app/actions/events.ts:1956-1959` computes `expectedAmount = resolveEventPriceAmount(event) × seats` — the flat, **online-discounted** price — and `confirm_event_manual_payment_v01` (defined `supabase/migrations/20260616000002…`) inserts that amount blindly with no cross-check. The PayPal path correctly sums `booking_items` via `resolveBookingChargeTotal` (`src/lib/events/event-payments.ts:91-107`); the manual path never does. Impact: for a booking of 1× Regular £15 + 1× Under-18 £8, marking "Cash paid" records 2× flat price; every cash payer is also credited the online-only discount. Payments ledger, "Paid" stat and `maxRefundable` are all wrong. Fix: reuse `resolveBookingChargeTotal` in `markEventBookingPaidManually`, and decide explicitly whether door payments get the online discount (they shouldn't per the pricing model — use `resolveEventTicketPriceAmount`).

**EV-03 — Staff seat edits desync multi-type bookings: line items, charge, and attendee names all go stale; prepaid bookings change size with no money movement.**
`updateEventManualBookingSeats` (`src/app/actions/events.ts:1115-1337`) → `update_event_booking_seats_staff_v05` (`supabase/migrations/20260708000000…`). Three compounding problems: (a) the default-item sync trigger deliberately skips multi-type bookings (`supabase/migrations/20260721000001…:52-56`), so `bookings.seats` changes but `booking_items` quantities don't — the staff table then shows "Seats: 5" with breakdown "1× Regular, 1× Non-Alcohol", and a still-pending payment link charges the stale items sum (`event-payments.ts:97-101`); (b) the RPC has **no payment-mode guard** — a confirmed **prepaid** booking can be grown 2→4 seats with no charge, or shrunk 6→2 with no refund prompt; (c) `bookings.attendee_names` is never truncated/extended, so the names list no longer matches seats on door lists/emails. Fix: block (or route to an explicit charge/refund flow) seat changes on prepaid-confirmed bookings; for multi-type bookings either block staff seat edits ("edit ticket lines instead") or proportionally update `booking_items`; reconcile `attendee_names` length.

**EV-04 (user-reported A+B, confirmed at exact locations) — Manual booking form can't capture who the customer is or what they're buying.**
(a) New-customer path renders **phone only** — `EventDetailClient.tsx:1060-1068`; `newFirstName/newLastName` state (194-195) is only populated by `CustomerSearchInput` selection (584-595), yet the action accepts `firstName/lastName` (`events.ts:785-786`). New customers land nameless. (b) The "Ticket type" select (1082-1094) is actually seated/standing preference, communal events only. Sibling gaps beyond the known issues: `createEventManualBooking` (`events.ts:810-990`) never passes `ticketSelections` or `attendeeNames`, so **staff cannot create a multi-type booking or record attendee names at all** — every staff booking is default-type via v06 while the website sells per-type. Fix: render name inputs; when `ticketTypesEnabled` and the event has >1 active type, render a per-type quantity basket + optional per-seat names and pass `ticketSelections` through (service already supports it, `event-bookings.ts:139,512-529`).

## Medium

**EV-05 — "Paid" figures double-count refunds.**
`getEventBookings` fetches all `payments` rows with **no `charge_type` filter** (`events.ts:686-690`) and counts any row whose status ∈ {succeeded, paid, partially_refunded, refunded} as paid (732-736). A completed refund row (`charge_type='refund'`, status `refunded`) plus the source charge (flipped to `refunded` by `manage-booking.ts:445-454`) both match → a fully refunded £20 booking shows "£40 refunded", and the "Paid" stat card (`EventDetailClient.tsx:239-242,1036-1039`) inflates. Fix: filter to `charge_type IN ('prepaid_event','seat_increase')` and subtract refund rows.

**EV-06 — Transfer discards ticket types and attendee names, and mislabels payment method as "Comp".**
`transferEventBooking` (`events.ts:2300-2314`) recreates the booking with plain `seats` — no `ticketSelections`, no `attendeeNames` — so the replacement gets a default-type line at the **target event's current price** via the sync trigger; per-type door lists and name lists vanish. When pending, it's confirmed as a £0 `comp` payment (2333-2344), and the method-summary precedence puts Comp first (`events.ts:749-758`) so a genuinely PayPal-paid transferred booking displays "Comp". Fix: copy `booking_items` + `attendee_names` to the new booking; exclude £0 comp rows from the method summary.

**EV-07 — Transfer is non-transactional; a mid-sequence failure strands payments on the new booking while the original stays live.**
`events.ts:2365-2435`: move payments → cancel original → release holds/cancel tables → insert `event_ticket_transfers`, each `throw`ing on error with no compensation. If the original-cancel (2380-2391) fails, the customer holds **two active bookings** and all payments now hang off the new one; the transfer-dedup guard (2223-2243) is also check-then-act, not atomic. Fix: wrap in a single RPC (pattern already established for booking creation), or add compensating rollbacks + a unique constraint on `event_ticket_transfers.original_booking_id`.

**EV-08 — Per-type sell-out returns HTTP 500 to the website instead of a sold-out state.**
`create_event_booking_v07` raises `ticket_type_capacity_exceeded` / `invalid_ticket_type` exceptions (`supabase/migrations/20260721000001…:144-155`), which surface as `rpcFailed` (`event-bookings.ts:539-558`) → `'Failed to create event booking', DATABASE_ERROR, 500` (`api/event-bookings/route.ts:367-369`). A dedicated-capacity type selling out is a normal business condition; customers get a generic failure and marketing sees 500s. Fix: pre-check per-type remaining before the RPC (or catch the SQLSTATE and map to a `blocked/ticket_type_sold_out` 409 payload the website can render).

**EV-09 — Check-in kiosk creates confirmed bookings that bypass capacity and payment.**
`ensureBooking` (`src/app/actions/event-check-in.ts:300-337`) inserts directly into `bookings` (`seats:1, status:'confirmed'`) without the capacity RPC or any payment record — on a sold-out or **prepaid** event a walk-in gets a free confirmed seat, skewing booked counts and revenue, and (unlike every other path) with no per-event capacity guard. The insert does get a default `booking_items` line via the sync trigger, so type accounting holds. Fix: route through `EventBookingService.createBooking` (source `walk-in`, `shouldSendSms:false`) or at minimum record a comp/unpaid marker and check the capacity snapshot.

**EV-10 — No audit logging on staff seat updates.**
`updateEventManualBookingSeats` (`events.ts:1115-1337`) contains no `logAuditEvent` call — cancel (1761), mark-paid (2033), transfer (2462) and create (946) all log. Seat changes alter capacity and (for paid bookings) money exposure. Fix: add an `update`/`event_booking` audit entry with old/new seats.

**EV-11 — Refunds are a one-shot decision at cancel time; there is no after-the-fact refund path.**
`getEventBookingRefundInfo` is wired only into the cancel dialog (`EventDetailClient.tsx:327-355`), and `cancelEventManualBooking` early-returns `already_cancelled` (1420-1432). A manager who cancels with "No refund" (the checkbox default when `canRefund=false` info hasn't loaded yet — dialog confirm is **not** disabled during `cancelRefundLoading`, `EventDetailClient.tsx:663-732`) cannot issue a refund later from AMS at all; ditto partial top-up refunds after the fact. Fix: add a "Refund…" action on cancelled/paid bookings reusing `processEventRefund` (idempotency machinery already exists); disable the confirm button while refund info is loading.

**EV-12 — "Est. Revenue" is a hardcoded £25/seat fiction.**
`src/lib/events/stats.ts:1,70` — `ESTIMATED_REVENUE_PER_BOOKED_SEAT = 25` regardless of actual event price, free events, or ticket-type mix; shown as a money figure ("Est. Revenue") next to a real "Paid" figure on the detail page (`EventDetailClient.tsx:1032-1035`). Fix: compute from `booking_items` sums (with event-price fallback), or relabel/remove.

**EV-13 — Transfer to a cheaper prepaid event silently keeps the customer's overpayment.**
`events.ts:2284-2298` blocks only when the target costs **more**; when it costs less the surplus is neither refunded nor mentioned in the SMS/email ("your tickets have been transferred…", 2113). Money owed to the customer becomes invisible except in `event_ticket_transfers.metadata`. Fix: compute the delta and either offer the manager a partial refund (reuse cancel-dialog UX) or state the credit position explicitly in comms and audit.

## Low

**EV-14 — Capacity stats ignore live payment holds and count expired bookings.**
`stats.ts:24-29` excludes `pending_payment` from booked seats while the capacity RPC counts unexpired holds — during hold windows the staff "Capacity %" understates real availability pressure; meanwhile `activeBookings` in the client (`EventDetailClient.tsx:221-224`) filters only `cancelled`/reminder rows, so `status='expired'` bookings inflate the Overview tab count and "Active Bookings" card relative to `totalSeats`. Align both on one definition (booked + held).

**EV-15 — Transfer target dropdown offers past events.**
`page.tsx:128` loads 500 events of all statuses; the client filter (`EventDetailClient.tsx:996-1010`) excludes only `cancelled`/`draft`. The RPC will bounce past events with `event_started`, but staff see them as valid options. Filter by date ≥ today.

**EV-16 — Reconciliation cron silently skips broken pending refunds forever.**
`api/cron/event-paypal-reconciliation/route.ts:144-149`: pending refund rows without `metadata.paypal_refund_id` just increment `skipped` on every run with no exception row or alert. Raise an `event_payment_exceptions` entry after N skips.

**EV-17 — Minor UI/UX gaps on the staff detail page.**
(a) Seat inputs silently clamp to 1–20 (`events.ts` schema 783,1003; client `Math.min(20,…)` at `EventDetailClient.tsx:279,311`) — typing 30 books 20 with a success toast. (b) One-click "Comp" with no confirmation (`EventDetailClient.tsx:1276-1278`) zeroes revenue on a pending booking. (c) Cancel-booking ConfirmDialog lacks a `loading` prop (double-submit window; delete dialog has one at 743). (d) No staff path anywhere to edit `attendee_names` or a booking's ticket-type composition post-creation — the website is the only writer.

**EV-18 — Flag-off regression risk for existing multi-type bookings.**
Every charge/display call is gated on `eventTicketTypesEnabled()` (`event-payments.ts:95`, `events.ts:712`, emails). If `EVENT_TICKET_TYPES_ENABLED` is ever switched off while multi-type bookings exist, pending payment links revert to flat-price × seats (wrong amount vs. the PayPal order already created) and breakdowns vanish from door lists. Document the flag as one-way, or gate on data (`booking_items` presence) rather than env for charge computation.

---

### Suggested priority order
1. EV-01 (lost refunds), EV-02 (wrong money recorded), EV-03 (prepaid/multi-type seat edits) — money-correctness, small blast radius each.
2. EV-04 (staff booking form parity: names + ticket types) — the largest staff-vs-website feature lag, and it feeds EV-03/EV-06.
3. EV-05/EV-06/EV-07 (reporting integrity + transfer robustness).
4. EV-08/EV-09 (public 500s, kiosk bypass), then the Mediums/Lows.
