# BOH Table Bookings — Test Matrix
Generated: 2026-03-15

## Scope
- `src/app/api/boh/table-bookings/route.ts`
- `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx`
- `src/app/api/cron/table-booking-deposit-timeout/route.ts`

---

## Bug A: Filter — Cancelled bookings never appear in BOH view

### Root Cause (confirmed by code trace)
The client constructs `searchParams` with only `{ date, view }` — no `status` param is ever appended (lines 392–395 of `BohBookingsClient.tsx`). The `statusFilter` state is used only in a client-side `useMemo` filter (line 516–550) which runs AFTER the API response. Since the API receives no `?status=` param, `statusFilterRaw` is `null`, `parsedStatusFilters` is `null`, and `showingCancelledExplicitly` is `false`. The API then strips cancelled bookings in the filter block (lines ~434–450 of the route). Cancelled bookings are removed before the client ever receives them; the client-side `statusFilter` has nothing to match against.

### Filter Tests

| TC | Description | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| TC001 | Select "Cancelled" filter | `statusFilter = 'cancelled'` | Cancelled bookings shown | API never sends `?status=cancelled`; API strips all cancelled rows; client filter returns 0 results | **FAIL** |
| TC002 | Select "All statuses" | `statusFilter = 'all'` | All bookings shown | API gets no `?status=` param; strips cancelled; cancelled missing from "all" | **FAIL** |
| TC003 | Search "Loveridge" | `searchTerm = 'loveridge'` | TB-8BAA3C8F found (status: cancelled) | Booking was cancelled; API strips it; not in client cache; search finds nothing | **FAIL** |
| TC004 | Change status filter — no page reload | Set `statusFilter` after initial load | Results update immediately | Client-side filter runs on `useMemo`; re-filters already-received data; no refetch triggered; BUT the data set never contained cancelled rows | **FAIL (hidden)** — filter runs but no cancelled rows present |
| TC005 | API called with no `?status=` param | `GET /api/boh/table-bookings?date=X&view=day` | Behaviour is defined | API returns all non-cancelled bookings (cancelled stripped by `else if (!showingCancelledExplicitly)` guard) | **DEFINED but wrong default** |
| TC006 | API called with `?status=cancelled` | `GET /api/boh/table-bookings?date=X&view=day&status=cancelled` | Only cancelled bookings returned | API correctly filters to cancelled via `parsedStatusFilters.has('cancelled')` | **PASS** (API is correct when param present) |
| TC007 | API called with `?status=confirmed,cancelled` | Multi-value param | Both statuses returned | API splits on comma, returns union | **PASS** |
| TC008 | API called with `?status=all` | "all" is not a real status value | Possibly broken — `parsedStatusFilters` would be `Set(['all'])`, no booking has `status = 'all'` → empty results | Empty result set | **FAIL** — "all" must be handled as "no filter" |
| TC009 | Filter change triggers refetch | Change `statusFilter` from UI | New API call with updated status param | No refetch occurs; same data re-filtered client-side | **DESIGN GAP** — works if client sends status on fetch; currently fetch ignores filter state |

---

## Bug B: Auto-cancellation fires on deposit_waived = true

### Root Cause (confirmed by code trace)
`table-booking-deposit-timeout/route.ts` queries `table_bookings` with `.eq('status', 'pending_payment')`. It selects only `id, customer_id, booking_reference, booking_date, booking_time` — **`deposit_waived` is not selected and not checked**. Every `pending_payment` booking within 24h of its booking time is cancelled unconditionally. TB-8BAA3C8F had `deposit_waived = true` and `status = pending_payment`; the cron fired at ~19:00 on 2026-03-14 and cancelled it.

A second, independent bug: `sunday_preorder_completed_at` was set to 2026-03-14 18:35 (24 min before cancellation). The cron does not check this field; it cancelled the booking despite the pre-order being complete.

### Auto-Cancellation Tests

| TC | Description | Input | Expected | Actual | Result |
|---|---|---|---|---|---|
| TC010 | `deposit_waived = true`, `status = pending_payment`, booking within 24h | Cron runs | Booking NOT cancelled | `deposit_waived` not selected, not checked; booking cancelled unconditionally | **FAIL** |
| TC011 | `sunday_preorder_completed_at` is non-null, booking within 24h | Cron runs | Booking NOT cancelled (strong signal of active/committed booking) | Not checked; booking cancelled | **FAIL** |
| TC012 | `deposit_waived = false`, `payment_status = pending`, 24h window | Cron runs | Booking IS cancelled | Booking correctly cancelled | **PASS** |
| TC013 | `deposit_waived = false`, `payment_status = paid`, 24h window | Cron runs | Booking NOT cancelled (deposit paid) | `status` check is `.eq('status', 'pending_payment')` — if status was updated to `confirmed` on payment, booking is excluded. If status is still `pending_payment` despite payment, would be incorrectly cancelled | **CONDITIONAL** — depends on whether payment flow updates `status` |
| TC014 | Booking cancelled when `deposit_waived = true` — can it be recovered? | Staff uncancels | Re-activate to `confirmed` | No auto-recovery mechanism; requires manual DB update or staff action through booking detail page | **DATA LOSS RISK** — real booking (TB-8BAA3C8F) was incorrectly cancelled |
| TC015 | Cron runs hourly (`0 * * * *`) — same booking could be processed twice | Race condition | Idempotent | Second run: booking now has `status = cancelled`, `.eq('status', 'pending_payment')` guard excludes it | **PASS** — race guard works |
| TC016 | Booking time is midnight — `new Date('YYYY-MM-DDT undefined')` | `booking_time` is null | Undefined behaviour | `booking_time` not validated; `new Date('2026-03-15Tundefined')` → Invalid Date, comparison returns `NaN > N` → `false` → booking cancelled | **POTENTIAL FAIL** for null booking_time |
| TC017 | Booking is `is_venue_event = true` — venue events exempt from deposit | Cron runs | Not cancelled | No check for venue event; only status checked | **FAIL** — venue event bookings with `pending_payment` will also be cancelled |

---

## State Consistency Tests

| TC | Description | Expected | Finding |
|---|---|---|---|
| TC020 | `deposit_waived = true` + `payment_status = pending` — valid state? | Valid; means deposit was waived so no payment required | DB allows it; FOH booking creation sets `deposit_waived = true` when `waive_deposit` or `is_venue_event`; `payment_status` may remain `pending` | **VALID STATE** — but cron treats it as unpaid |
| TC021 | After incorrect auto-cancel of TB-8BAA3C8F — orphaned pre-order records? | Pre-order data preserved in DB | `sunday_preorder_completed_at` is a timestamp on the booking row itself; no orphaned child records expected | **LOW RISK** — pre-order is a field, not a child table |
| TC022 | Client-side `statusFilter = 'cancelled'` filters `filteredBookings` using `booking.status` vs `booking.visual_status` | Both checked | Code at line 521–524 checks both; logic is correct — the problem is upstream (no data) | **PASS** (logic correct if data present) |
| TC023 | `?status=all` passed to API | API returns all bookings | `parsedStatusFilters` = `Set(['all'])`; no booking has status "all"; zero results | **FAIL** — "all" is a UI-only sentinel, must not be passed to API |

---

## Acceptance Criteria (for implementation engineer)

### Fix A — Filter
1. Client must send `?status=cancelled` when `statusFilter === 'cancelled'` and NOT omit the param
2. Client must NOT send `?status=all` — omit the param entirely when filter is "all" (preserves API default behaviour of stripping cancelled)
3. Fetching must be triggered when `statusFilter` changes (or all data fetched once and filtered client-side — but then cancelled must be included in the initial fetch)
4. Preferred approach: always fetch all statuses on load (send `?status=confirmed,pending_payment,cancelled,...` or no status at all but include cancelled), filter client-side
5. TC001, TC002, TC003 must pass after fix

### Fix B — Auto-cancellation
1. Cron must select `deposit_waived` and skip bookings where `deposit_waived = true`
2. Cron must select `sunday_preorder_completed_at` and skip bookings where it is non-null
3. Cron must check `is_venue_event` or an equivalent exemption flag (if it exists) and skip
4. TC010, TC011, TC017 must pass after fix
5. TB-8BAA3C8F must be manually restored to `confirmed` status with `cancelled_at = null`, `cancelled_by = null`, `cancellation_reason = null`
