# Sunday Lunch Booking — End-to-End Discovery Findings

**Date:** 2026-04-18
**Scope:** Customer-reported failure to book Sunday lunch via the-anchor.pub; and pre-order/customer details appearing in notes rather than structured fields.

Reviewed both codebases:
- Website: `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub`
- Management: `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`

---

## Summary

Two distinct problems, each with a clear root cause.

| # | Problem | Root cause | Confidence |
|---|---|---|---|
| A | Pre-order items + customer name/email land in `special_requirements` (notes) instead of `table_booking_items` + `customers` | Website proxy flattens structured data into one text blob; public management API has no schema support for pre-order items | **Confirmed** |
| B | Customers can't complete Sunday lunch bookings | `capture-order` SELECT references non-existent `sunday_lunch` column → PostgREST error → handler returns 404 "Booking not found". Broken since commit `e10f653a` on 2026-03-15. | **Confirmed from prod logs** |

---

## Problem A — Pre-orders and customer details in `notes`

### Flow trace

1. **Frontend** `components/features/TableBooking/SundayLunchBookingForm.tsx:475-492` posts:
   ```js
   {
     booking_type: 'sunday_lunch',
     date, time, party_size,
     customer: { first_name, last_name, email, mobile_number, sms_opt_in },
     special_requirements, dietary_requirements, allergies,
     menu_selections: [ { custom_item_name, item_type, quantity, guest_name, price_at_booking } ],
     source: 'website'
   }
   ```
   POST → `/api/table-bookings/create` (line 506)

2. **Website proxy** `app/api/table-bookings/route.ts:186-258` — `normaliseIncomingPayload()`
   - `isNewShape` check (line 196-199) requires top-level `phone`, `purpose`, or `sunday_lunch`. Sunday lunch payload has none of those top-level → falls into **legacy branch** (line 235).
   - Legacy branch reads phone from `customer.mobile_number` ✓
   - **Legacy branch drops `first_name`, `last_name`, `email`** (line 248-257 returns only `{phone, date, time, party_size, purpose, notes, sunday_lunch}`)
   - `buildLegacyNotes()` (line 136-183) concatenates `Name: ...`, `Email: ...`, `Special requirements: ...`, `Dietary requirements: ...`, `Allergies: ...`, `Sunday lunch pre-order: Guest 1: Roasted Chicken x1 | Guest 2: Pork Belly x1 | ...` into a single text blob
   - Blob is forwarded in the `notes` field to the management API

3. **Management API** `src/app/api/table-bookings/route.ts:40-56` — Zod schema accepts only:
   ```
   phone, first_name?, last_name?, email?, date, time, party_size,
   purpose, notes?, sunday_lunch?, default_country_code?, skip_customer_sms?
   ```
   **No field for structured pre-order items.** Management side has no way to receive `menu_selections[]` from the public booking API.

4. **RPC** `create_table_booking_v05` (migration `20260509000005`)
   - Only parameter `p_notes` (no items array)
   - Inserts into `table_bookings.special_requirements` column
   - No `INSERT INTO table_booking_items` anywhere in ingestion path

5. **Admin pre-order tab** `src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx` reads from `table_booking_items` via `/api/boh/table-bookings/[id]/preorder` → `getSundayPreorderPageDataByBookingId()` → table stays empty for website-driven bookings.

6. **FOH path (works)** — `src/app/api/foh/bookings/route.ts` *does* accept `sunday_preorder_items[]` and calls `saveSundayPreorderByBookingId()` (line 21 import) on successful booking. Only staff-initiated bookings via FOH get proper pre-order rows.

### Impact
- Kitchen pre-order PDF (`/api/boh/table-bookings/preorder-sheet`) is empty for every website booking — kitchen must parse the text blob.
- First-time customers booking via website end up in `customers` table with phone only; name & email never persist structurally.
- `table_booking_items` aggregations (reporting, quantities, dish popularity, guest allocation) are wrong.
- Dietary requirements and allergies are buried in free text rather than the `dietary_requirements` / `allergies` arrays or proper columns.

### Fix shape (for discussion, not implementing yet)
1. Extend management API's `CreateTableBookingSchema` with `first_name`, `last_name`, `email` (already present but never populated from website), and a new `sunday_preorder_items` array.
2. When items are present, call `saveSundayPreorderByBookingId()` after the RPC returns a booking id (same pattern as FOH route).
3. Fix website proxy's `normaliseIncomingPayload()` legacy branch to extract customer first/last/email and forward them as top-level fields.
4. Stop stuffing name/email/dietary/allergies/menu-selections into the notes blob; map them to their proper columns/arrays.

---

## Problem B — Customers cannot complete Sunday lunch bookings  [ROOT CAUSE CONFIRMED]

### What the customer experiences

Form fills OK → deposit review step → PayPal/debit card flow → bank authorises payment → UI shows **"Payment error: Booking not found"**. Customer's card has a pending authorisation for £10 × party size that will release unclaimed in a few days. Booking is stranded in the database with `status='pending_payment'`.

### Root cause

[src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts:42](src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts#L42) reads:

```ts
.select('id, status, payment_status, paypal_deposit_order_id, paypal_deposit_capture_id, customer_id, party_size, start_datetime, booking_reference, sunday_lunch, source')
```

**`sunday_lunch` is not a column on `table_bookings`.** Confirmed against `src/types/database.generated.ts:9839-9897` — the Sunday lunch indicator is the `booking_type` enum (`'sunday_lunch' | 'regular'`). PostgREST returns an error for the unknown column; the handler treats any `fetchError` as "Booking not found" and returns 404.

Line 136 then uses `booking.sunday_lunch ?? false` — reinforcing that the author assumed a boolean column that never existed.

### When it broke

Commit [`e10f653a`](https://github.com/) — *"feat: defer confirmation notifications until deposit is captured"* — Sun Mar 15 10:15:42 2026. From that date onwards, **every website booking that required a PayPal deposit has been failing at capture**:
- Every Sunday lunch booking (£10/person deposit mandatory).
- Every group booking for 7–20 covers on any day of the week (deposit required per RPC line 380).

Over 5 weeks of lost bookings. This also explains why bookings didn't appear in FOH — they stayed stuck in `pending_payment` and were eventually cancelled by the `event-booking-holds` cron (`cancellation_reason: 'payment_hold_expired'`).

### Evidence from your test

From the Vercel log excerpt you shared (requestId `mmh7w-1776526579944-c6ef44ba367d`):

| Time (London ≈ 15:34–15:36) | Event |
|---|---|
| 15:34:53 | `POST /api/table-bookings` → **201** (booking `6ac0fc03` created) |
| 15:34:54 | `POST /paypal/create-order` → **200** (booking found, order saved, PayPal order returned) |
| 15:36:19 | `POST /paypal/capture-order` → **404 "Booking not found"** |

Same deployment, same booking id. Between 15:34 and 15:36 nothing deleted the booking — the capture endpoint's SELECT fails on the `sunday_lunch` column reference.

### Fix (proposed, not applied)

Two lines in `capture-order/route.ts`:

```ts
// line 42 — use the real column
.select('id, status, payment_status, paypal_deposit_order_id, paypal_deposit_capture_id, customer_id, party_size, start_datetime, booking_reference, booking_type, source')

// line 136 — derive the boolean
sunday_lunch: booking.booking_type === 'sunday_lunch',
```

Secondary improvement (defence-in-depth): log the actual `fetchError` before returning 404 so future schema drifts surface immediately rather than hiding behind a misleading user-facing message.

### Also stranded bookings

Customers who've hit this over the past 5 weeks may have stranded `pending_payment` rows (now cancelled by cron with `payment_hold_expired`). None of them were actually charged — PayPal captures only happened for FOH/staff-created deposits (which don't use this endpoint). Nothing to refund. But the data quality picture for that 5-week period will show a spike in `cancelled` / `payment_hold_expired` bookings that are actually paying customers who were turned away.

### Other risk factors (still real, lower priority)

### 1. Service window rejection (highest likelihood)

**Where:** `app/api/table-bookings/route.ts:345-358` on the website, and the RPC at `20260509000005_create_table_booking_v05_deposit_waived.sql:176-180`.

- Website proxy calls `anchorAPI.getBusinessHours()` then `resolveServiceRanges(businessHours, date, { bookingType: 'sunday_lunch', purpose: 'food' })`
- If the Sunday row in `business_hours` has any of:
  - `is_kitchen_closed = true`
  - `kitchen_opens IS NULL` or `kitchen_closes IS NULL`
  - Or a `special_hours` override for that specific Sunday with the same conditions
- Then *every* Sunday lunch booking at any time on that day returns 400 with: *"Sunday lunch is only available during the Sunday lunch service window…"*
- Management RPC also blocks with `state='blocked', reason='outside_hours'`.

**Confirm by running (against prod):**
```sql
SELECT day_of_week, opens, closes, kitchen_opens, kitchen_closes,
       is_closed, is_kitchen_closed
FROM business_hours
WHERE day_of_week = 0;

SELECT date, is_closed, is_kitchen_closed, kitchen_opens, kitchen_closes
FROM special_hours
WHERE date >= CURRENT_DATE
  AND EXTRACT(DOW FROM date) = 0
ORDER BY date;
```
Also check any `system_settings` / service-override flag that can disable Sunday lunch.

### 2. PayPal deposit flow instability

Recent commits on the website (last 30 days) show active PayPal work — `af3d126 show PayPal create-order error`, `834d83d suppress SMS for deposits`, `d5a1675 pass currency=GBP`, `e2ded6c integrate deposit payment into review step`, `850b36c add PayPal proxy routes`. Sunday lunch requires a £10/person deposit (memory from 2026-03-21 review). If PayPal order creation fails, the customer sees an error after submit and can't complete the booking.

### 3. Capacity / no_table

Memory from prior review notes the availability endpoint only checks service windows, not actual table occupancy, and capacity is hardcoded at 50 vs. 34 real covers. Busy Sundays can pass the availability check and then fail at the RPC with `reason='no_table'`. The user sees a confusing "Booking could not be completed" error after filling 4 steps.

### 4. Cutoff (1pm Saturday London)

`hasSundayLunchCutoffPassed()` rejects Sunday bookings submitted after 1pm Saturday London time (`app/api/table-bookings/route.ts:323-338`). Error message is specific and mentions the cutoff. If customers are booking on a Saturday afternoon, they'll see this — reasonable behaviour but a common source of confusion.

### 5. Turnstile (low likelihood for website)

Commit `5e44525` moved the Turnstile token from request body to `x-turnstile-token` header. Management side already skips Turnstile for API-key-authenticated requests (commit `8bacc70e`). Website-driven bookings shouldn't be affected. *However* the website's own spam-protection layer has a Turnstile enforcement (`lib/spam-protection.ts`) — route.ts:306 calls `checkSpamProtection(request, body, { skipTurnstile: true })` so it's explicitly bypassed. Should be fine.

### 6. Country code allowlist

Commit `1cc2b05` added phone country allowlist. If a customer enters a non-UK international number the allowlist doesn't cover, they'll be rejected before even reaching the management API.

### To pin this down I need one of:
- A specific failing booking (date, time, party size, error message screenshot)
- Vercel logs for `/api/table-bookings/create` requests over the last 48 hours, filtered to 4xx/5xx
- Live values for `business_hours` (day_of_week=0) and any active `special_hours` / service-override rows

---

## Other defects found incidentally

1. **Sunday lunch form uses legacy payload shape** — even though it builds structured `menu_selections[]`, the way it nests customer data triggers the legacy normaliser that drops those fields. This looks like a payload/shape mismatch rather than intentional legacy support.
2. **Two parallel ingestion routes** — `/api/table-bookings/create` (website proxy) and `/api/booking/submit` (legacy, `lib/api/client.ts`) both exist on the website and both flatten menu selections. Consolidating would reduce drift risk.
3. **`lib/api/client.ts:132-178` `summarizeMenuSelections()`** — duplicates the flattening logic in `buildLegacyNotes`. Any fix to pre-order handling needs to cover both paths or remove the legacy one.

---

## What I did NOT verify (flagged for follow-up)

- The actual error customers see — no logs / Sentry read
- Whether `business_hours` row for Sunday is currently misconfigured
- Whether a current `service_overrides.sunday_lunch` is disabling it
- Whether the menu endpoint `/api/table-bookings/menu/sunday-lunch` is returning data correctly
- The PayPal deposit flow end-to-end (tests exist in `tests/api/booking-submit-deposit.test.ts`)
