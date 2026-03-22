# Structural Map — BOH Table Bookings

**Date:** 2026-03-15
**Target:** `src/app/(authenticated)/table-bookings/boh/` + `src/app/api/boh/table-bookings/`

---

## 1. File Inventory

### Primary Section Files

| File | Concern | Key Exports / Entry Points |
|------|---------|---------------------------|
| `src/app/(authenticated)/table-bookings/boh/page.tsx` | Routing / auth gate | `default` — server component; checks `table_bookings` RBAC permissions, redirects FOH-only users to `/table-bookings/foh` |
| `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx` | Client UI — all interactivity | `BohBookingsClient` — full booking list, filters, metrics, actions |
| `src/app/api/boh/table-bookings/route.ts` | API — list/query bookings | `GET` — date-range query, multi-schema-fallback select, server-side filter, response shaping |
| `src/app/api/boh/table-bookings/[id]/route.ts` | API — cancel/delete booking | `DELETE` — staff-initiated soft cancel with Stripe session expiry and SMS |
| `src/app/api/boh/table-bookings/[id]/status/route.ts` | API — status update | (status transition mutations) |
| `src/app/api/boh/table-bookings/[id]/deposit-link/route.ts` | API — deposit link | Send/regenerate Stripe checkout link |
| `src/app/api/boh/table-bookings/[id]/move-table/route.ts` | API — table reassignment | PATCH table_assignments |
| `src/app/api/boh/table-bookings/[id]/party-size/route.ts` | API — party size edit | PATCH party_size / committed_party_size |
| `src/app/api/boh/table-bookings/[id]/preorder/route.ts` | API — preorder edit | Manage pre-order items per booking |
| `src/app/api/boh/table-bookings/[id]/sms/route.ts` | API — manual SMS | Trigger SMS to guest |
| `src/app/api/boh/table-bookings/preorder-sheet/route.ts` | API — kitchen sheet | `GET` — CSV/PDF kitchen pre-order sheet for a given date |

### Supporting Files

| File | Concern |
|------|---------|
| `src/lib/foh/api-auth.ts` | `requireFohPermission(action)` + `getLondonDateIso()` — used by all BOH API routes |
| `src/lib/table-bookings/bookings.ts` | `sendTableBookingCancelledSmsIfAllowed()` — shared SMS helper |
| `src/lib/table-bookings/refunds.ts` | `refundTableBookingDeposit()` — Stripe/PayPal refund logic |
| `src/lib/payments/stripe.ts` | `expireStripeCheckoutSession()`, `isStripeConfigured()` |
| `src/app/api/cron/table-booking-deposit-timeout/route.ts` | Auto-cancel cron for unpaid deposits |
| `src/types/database.generated.ts` | Generated Supabase types including `table_bookings` row shape |

**Flags:**
- `BohBookingsClient.tsx` is very large (doing fetching, filtering, metrics, all rendering) — multiple concerns in one file.
- No dedicated service layer for BOH table booking logic; business logic split between API route and cron.

---

## 2. Flow Map

### Flow A — View Bookings List (primary read flow)

**Entry:** User navigates to `/table-bookings/boh`

1. `page.tsx` (server): Runs `checkUserPermission('table_bookings', 'view')` + `checkUserPermission('table_bookings', 'edit')` + `checkUserPermission('table_bookings', 'manage')` + `checkUserPermission('reports', 'view')` + `checkUserPermission('settings', 'manage')` in parallel.
2. `page.tsx`: If `!canView` → redirect `/unauthorized`. If `isFohOnlyUser(permissions)` → redirect `/table-bookings/foh`.
3. `page.tsx`: Renders `<BohBookingsClient>` passing permission booleans.
4. `BohBookingsClient` mounts; `useEffect` fires → calls `loadBookings()`.
5. `loadBookings()` builds `URLSearchParams({ date: focusDate, view })` — **no `status` param included**.
6. Fetches `GET /api/boh/table-bookings?date=YYYY-MM-DD&view=day` (plus parallel fetch for previous period).
7. `route.ts` `GET` handler:
   - a. `requireFohPermission('view')` — returns 401 if no session/permission.
   - b. Parse `date`, `view` query params → `computeRange()` → `{ focusDate, startDate, endDate }`.
   - c. Parse `status` query param → `statusFilterRaw` (always `null` in current client).
   - d. Parse `q` query param → `searchQuery`.
   - e. `Promise.all([loadBookingsRows(), loadTablesRows(), supabase.from('table_areas').select()])`.
   - f. `loadBookingsRows()`: tries 4 progressively-reduced SELECT columns on `table_bookings` (schema compatibility fallback); filters `.gte('booking_date', startDate).lte('booking_date', endDate).order(booking_date, booking_time ASC)`.
   - g. Parallel: fetch `table_assignments` for those booking IDs; fetch `events` for booking event_ids.
   - h. Map each booking row → response shape (derives `visual_status`, `start_iso`, `end_iso`, `_search_blob`, guest name).
   - i. **Filter**: `parsedStatusFilters = null` (no param) → `showingCancelledExplicitly = false` → **all `status='cancelled'` rows stripped unconditionally** (line 529–531).
   - j. Apply search filter if `searchQuery` present.
   - k. Sort and return `{ success: true, data: { bookings, tables, areas, view, focus_date, range_start_date, range_end_date, total } }`.
8. Client receives payload → `setBookings(payload.data.bookings)` — already missing all cancelled bookings.
9. `filteredBookings` (client-side `useMemo`): applies `statusFilter !== 'all'` filter. Cancelled bookings are absent so this filter has no effect regardless of selection.
10. UI renders table of `sortedBookings`.

**Decision points:**
- Step 2: permission + FOH redirect
- Step 7i: **THE BUG** — `parsedStatusFilters` is always `null` because client never sends `?status=`; therefore `showingCancelledExplicitly` is always `false`; cancelled bookings are always stripped at API level regardless of what the client filter dropdown shows.

---

### Flow B — Change Status Filter (client interaction)

1. User selects status from dropdown (options: all / confirmed / pending_payment / seated / left / no_show / cancelled / completed / visited_waiting_for_review / review_clicked).
2. `setStatusFilter(newValue)` updates React state.
3. `filteredBookings` useMemo re-runs — filters `bookings` array in client state.
4. **`loadBookings` is NOT called**; the API is NOT re-fetched when status changes.
5. Result: client-side filter only acts on data already in `bookings` state, which already had cancelled rows stripped at step A.7i.

**Note:** `statusFilter` is NOT in `loadBookings` dependency array. Changing the filter never triggers a new API call.

---

### Flow C — Change Date / View (navigation)

1. User clicks date forward/back or switches day/week/month.
2. `setFocusDate()` or `setView()` updates state.
3. `loadBookings` `useCallback` deps include `[focusDate, view]` → `useEffect` triggers re-fetch.
4. New fetch with updated `date` and `view` params — still no `status` param.
5. Same bug at A.7i applies to every fetch.

---

### Flow D — Staff Cancel Booking (BOH [id] DELETE)

**Entry:** Staff clicks cancel/delete button in `BohBookingsClient`

1. `BohBookingsClient` calls `DELETE /api/boh/table-bookings/:id`.
2. `route.ts` `DELETE`:
   - a. `requireFohPermission('manage')` — must have manage permission.
   - b. Load booking; check not already in `['completed', 'no_show', 'cancelled']` → 409 if so.
   - c. If `status='pending_payment'` and Stripe configured: fetch pending `payments` record; call `expireStripeCheckoutSession()`.
   - d. Update `table_bookings SET status='cancelled', cancelled_by='staff', cancellation_reason='boh_soft_delete'`.
   - e. Attempt `refundTableBookingDeposit()` (Stripe/PayPal).
   - f. Call `sendTableBookingCancelledSmsIfAllowed()`.
   - g. Return `{ success: true, data: { id, booking_reference, status, deleted_at, cancelled_at, soft_deleted: true } }`.

---

### Flow E — Auto-Cancel for Unpaid Deposit (cron)

**Entry:** Vercel cron hits `GET /api/cron/table-booking-deposit-timeout` (schedule: **not in vercel.json** — see Missing Pieces below)

1. Auth check: `Authorization: Bearer CRON_SECRET`.
2. `createAdminClient()` — service role, bypasses RLS.
3. Query `table_bookings WHERE status='pending_payment' AND booking_date <= now+25h`.
4. For each candidate: compute `bookingDateTime = new Date(booking_date + 'T' + booking_time)`.
5. **Decision**: if `bookingDateTime - now > 24h` → skip (booking not yet within 24h window).
6. **No check for `deposit_waived`** — if booking has `deposit_waived=true`, the cron still cancels it. (**BUG confirmed**.)
7. Update `status='cancelled', cancelled_by='system', cancellation_reason='deposit_not_paid_within_24h'`.
8. Guard: `.eq('status', 'pending_payment')` prevents double-cancel race condition.
9. Send cancellation SMS via `sendTableBookingCancelledSmsIfAllowed()`.
10. Log count; return `{ cancelled }`.

---

### Flow F — Kitchen Pre-Order Sheet Download

**Entry:** Staff clicks "Pre-order sheet" button

1. `GET /api/boh/table-bookings/preorder-sheet?date=YYYY-MM-DD`
2. `requireFohPermission('view')`.
3. Query `table_bookings WHERE booking_date=date AND status NOT IN ('cancelled','no_show')`.
4. Fetch `booking_preorder_items`, `table_assignments`, `tables` for those bookings.
5. Generate CSV/PDF output.

**Note:** Explicitly excludes cancelled bookings (correct behaviour for kitchen sheet).

---

## 3. Data Model Map

### `table_bookings` (primary table)

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `booking_reference` | text | e.g. TB-8BAA3C8F |
| `booking_date` | date | ISO YYYY-MM-DD |
| `booking_time` | time | HH:MM |
| `party_size` | int | |
| `committed_party_size` | int | nullable |
| `booking_type` | text | e.g. `sunday_lunch`, `standard` |
| `booking_purpose` | text | nullable |
| `status` | enum `table_booking_status` | confirmed / pending_payment / seated / left / no_show / cancelled / completed |
| `payment_status` | text | nullable |
| `special_requirements` | text | nullable |
| `seated_at` | timestamptz | nullable |
| `left_at` | timestamptz | nullable |
| `no_show_at` | timestamptz | nullable |
| `cancelled_at` | timestamptz | nullable |
| `cancelled_by` | text | nullable — 'staff' / 'system' / 'customer' |
| `cancellation_reason` | text | nullable — e.g. `deposit_not_paid_within_24h`, `boh_soft_delete` |
| `deposit_waived` | boolean | If true, deposit requirement is waived — **not checked by auto-cancel cron** |
| `start_datetime` | timestamptz | nullable; derived or set |
| `end_datetime` | timestamptz | nullable |
| `duration_minutes` | int | nullable |
| `hold_expires_at` | timestamptz | nullable |
| `event_id` | UUID FK | nullable → `events` |
| `customer_id` | UUID FK | → `customers` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Status transitions (known):**
- `pending_payment` → `confirmed` (payment received)
- `pending_payment` → `cancelled` (by cron: deposit timeout, or staff delete)
- `confirmed` → `seated` (arrival)
- `confirmed` → `no_show` (no show marked)
- `confirmed` → `cancelled` (staff delete)
- `seated` → `left` (departure)
- `seated` → `completed` (post-visit)
- `left` / `completed` → `visited_waiting_for_review` / `review_clicked` (post-visit review flow)

**Visual status derivation** (in `deriveVisualStatus()`):
- `no_show` or `no_show_at` set → `no_show`
- `left_at` set → `left`
- `seated_at` set → `seated`
- Otherwise → falls back to `status`

**What creates records:** External booking form / FOH booking entry (not mapped in this section).
**What reads records:** BOH list API (`route.ts`), preorder-sheet API, cron, `[id]` API.
**What updates records:** `[id]/route.ts` DELETE (cancel), `[id]/status/route.ts` (status transitions), `[id]/party-size/route.ts`, cron (auto-cancel).
**What deletes records:** No hard deletes observed — soft-cancel only via `status='cancelled'`.

### `table_assignments` (join table)

| Column | Notes |
|--------|-------|
| `booking_id` | FK → `table_bookings.id` |
| `table_id` | FK → `tables.id` |

### `tables`

| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `name` | Display name |
| `table_number` | nullable text |
| `area_id` | FK → `table_areas.id` (inferred) |

### `table_areas`

| Column | Notes |
|--------|-------|
| `id` | UUID PK |
| `name` | text |

### `payments`

Used in DELETE flow to find pending Stripe checkout sessions.

| Column | Notes |
|--------|-------|
| `table_booking_id` | FK |
| `charge_type` | 'table_deposit' |
| `status` | 'pending' / 'completed' / etc. |
| `stripe_checkout_session_id` | nullable |

### `customers`

Joined via `table_bookings_customer_id_fkey`.

| Column | Used |
|--------|------|
| `id` | |
| `first_name` | |
| `last_name` | |
| `mobile_number` | For SMS |
| `sms_status` | For SMS gate |

---

## 4. External Dependency Map

| Service | Used In | Call | Notes |
|---------|---------|------|-------|
| **Supabase DB** | All routes, cron | Anon key (auth routes) + service role (cron, admin) | RLS active; cron bypasses via admin client |
| **Stripe** | `[id]/route.ts` DELETE, `[id]/deposit-link/route.ts` | `expireStripeCheckoutSession()`, checkout session create | Conditional on `isStripeConfigured()` |
| **Twilio SMS** | `[id]/route.ts` DELETE, cron, `[id]/sms/route.ts` | `sendTableBookingCancelledSmsIfAllowed()` | Rate-limited; uses idempotency guards |
| **PayPal** | `lib/table-bookings/refunds.ts` | `refundTableBookingDeposit()` | Used in staff-cancel flow |

No webhooks inbound to this section. No async callbacks.

---

## 5. Missing Pieces Inventory

### Bug 1 — Status filter never sent to API (confirmed root cause)
- **Location:** `BohBookingsClient.tsx` `loadBookings` (line ~330)
- **Missing:** `status: statusFilter` in `URLSearchParams` constructor, and `statusFilter` in `useCallback` deps array.
- **Effect:** `route.ts` always receives `statusFilterRaw=null` → `parsedStatusFilters=null` → `showingCancelledExplicitly=false` → cancelled bookings unconditionally stripped for every request.

### Bug 2 — Auto-cancel ignores `deposit_waived` flag (confirmed)
- **Location:** `src/app/api/cron/table-booking-deposit-timeout/route.ts`
- **Missing:** `AND deposit_waived = false` in the candidate query (or a guard before the UPDATE).
- **Effect:** A booking with `deposit_waived=true` and `status='pending_payment'` will be auto-cancelled within 24h of the booking time, even though no deposit was required. This is what happened to Jason Loveridge's booking TB-8BAA3C8F.

### Missing — Cron not registered in vercel.json
- `table-booking-deposit-timeout` is **absent from `vercel.json` crons**. The cron file exists but is not scheduled. This means it must be triggered manually or via the jobs queue. Needs investigation — either intentional (triggered by jobs processor `* * * * *`), or it was accidentally removed. If not scheduled, the deposit-timeout logic never fires automatically.

### Missing — No re-fetch on status filter change
- When user changes the status dropdown, `loadBookings` is not called. The API filter capability exists server-side (once the param is sent) but is never leveraged. After the client-side param fix, a re-fetch on filter change would allow full server-side filtering.

### Missing — `deposit_waived` not surfaced in BOH list response
- The BOH list API response shape (`mappedBookings`) does not include `deposit_waived`. It is not in any of the 4 SELECT column strings in `loadBookingsRows`. Staff cannot see in the list whether a deposit was waived.

### Missing — No audit log for auto-cancel
- The cron at `table-booking-deposit-timeout/route.ts` writes no `logAuditEvent()` calls. Cancellations happen silently.

### Missing — No error handling in preorder-sheet for cancelled booking type filter
- `preorder-sheet` explicitly excludes `cancelled` — correct — but does not handle the case where `booking_type` filter might be needed (it returns all non-cancelled types including sunday_lunch and standard together).

### Flag — `[id]/route.ts` DELETE guards against already-cancelled bookings with 409
- This means staff cannot "re-cancel" a booking that was already auto-cancelled (e.g. to attach a different cancellation reason or trigger a refund). May be intentional but could create operational friction.

---

## Summary Reference

**Two bugs confirmed:**
1. `BohBookingsClient.tsx` never sends `?status=` to the API → cancelled bookings always invisible regardless of filter selection.
2. `table-booking-deposit-timeout` cron does not check `deposit_waived` → cancels deposit-waived bookings that remain in `pending_payment` status.

**Files requiring changes for Bug 1 fix:**
- `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx` — add `status` to URLSearchParams and useCallback deps.

**Files requiring changes for Bug 2 fix:**
- `src/app/api/cron/table-booking-deposit-timeout/route.ts` — add `.eq('deposit_waived', false)` to candidate query.
