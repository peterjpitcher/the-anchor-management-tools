# Review Brief: /private-bookings

## Target Section
`src/app/(authenticated)/private-bookings/` + `src/app/api/private-bookings/` + `src/app/actions/privateBookingActions.ts` + `src/services/private-bookings.ts` + `src/lib/contract-template.ts` + `src/types/private-bookings.ts`

## Known Problems
1. **Contract generation is broken** — the `/api/private-bookings/contract` route fails silently; the contract page redirects to it via `window.location.href` but users get an error or blank page.
2. Other inconsistencies suspected but not yet identified.

## File Inventory (from recon)

### Critical Path
- `src/app/api/private-bookings/contract/route.ts` — contract API GET handler
- `src/app/(authenticated)/private-bookings/[id]/contract/page.tsx` — contract UI (client redirect)
- `src/app/actions/privateBookingActions.ts` — all server actions (~1180 lines)
- `src/services/private-bookings.ts` — business logic service layer
- `src/lib/contract-template.ts` — HTML contract generator
- `src/types/private-bookings.ts` — type definitions

### UI Pages
- `src/app/(authenticated)/private-bookings/page.tsx` — booking list
- `src/app/(authenticated)/private-bookings/[id]/page.tsx` — detail (server)
- `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` — detail (client, ~1500+ lines)
- `src/app/(authenticated)/private-bookings/[id]/edit/page.tsx` — edit form
- `src/app/(authenticated)/private-bookings/[id]/items/page.tsx` — items management
- `src/app/(authenticated)/private-bookings/[id]/messages/page.tsx` + `PrivateBookingMessagesClient.tsx`
- `src/app/(authenticated)/private-bookings/new/page.tsx` — create form
- `src/app/(authenticated)/private-bookings/calendar/page.tsx` — calendar view
- `src/app/(authenticated)/private-bookings/sms-queue/page.tsx` — SMS queue
- `src/app/(authenticated)/private-bookings/settings/page.tsx` — settings index
- `src/app/(authenticated)/private-bookings/settings/spaces/page.tsx`
- `src/app/(authenticated)/private-bookings/settings/catering/page.tsx`
- `src/app/(authenticated)/private-bookings/settings/vendors/page.tsx`
- `src/app/(authenticated)/private-bookings/PrivateBookingsClient.tsx` — list client
- `src/app/(authenticated)/private-bookings/PrivateBookingDetailServer.tsx`

### Supporting
- `src/app/actions/private-bookings-dashboard.ts` — dashboard data
- `supabase/migrations/20260502000000_private_booking_payments.sql`
- `supabase/migrations/20260402020000_private_booking_lifecycle.sql`
- `supabase/migrations/20260401150000_create_private_booking_transaction.sql`
- `supabase/migrations/20260420000001_add_contract_note_to_private_bookings.sql`

## Business Rules (as understood)

1. **Booking lifecycle**: draft → confirmed → completed | cancelled
2. **Deposit**: refundable security deposit (default £250), paid in cash, returned within 48h post-event
3. **Balance**: full event cost due 7 days before event date
4. **Contract**: generated on demand as HTML/print, version-tracked, audit-logged
5. **Items**: spaces (per-hour), catering (per-head or total), vendors (fixed), other
6. **Discounts**: item-level (percent or fixed) + booking-level discount
7. **SMS**: approval queue — SMS is queued, approved by manager, then sent via Twilio
8. **Permissions**: module `private_bookings`, actions: `view`, `create`, `edit`, `delete`, `manage_deposits`, `generate_contracts`, `manage_spaces`, `manage_catering`, `manage_vendors`, `view_sms_queue`, `approve_sms`, `send`

## Key Red Flags Spotted in Recon

### Contract Route (`/api/private-bookings/contract/route.ts`)
- Uses `user_has_permission` RPC with action `'generate_contracts'` — but other actions use `checkUserPermission()` which may use different permission key names
- Audit insert to `private_booking_audit` table: **if this insert fails, the route returns 500 and the HTML is never sent** — HTML is generated first but audit failure blocks delivery
- Contract version update: **if this update fails after successful audit insert, also returns 500** — partial-failure path: audit logged but version not bumped
- Uses `booking.contract_version + 1` — if `contract_version` is null/undefined this produces NaN
- Logo URL is `/logo-black.png` — a relative URL; in the API route context this may not resolve correctly if the contract is opened in a new tab/window

### Type Mismatches
- `VenueSpace` type: `capacity_seated`, `rate_per_hour`, `minimum_hours`, `setup_fee`, `active`
- But actions use: `capacity`, `hire_cost`, `is_active` — field name mismatch
- `CateringPackage` type: `cost_per_head`, `minimum_guests`, `active`
- But actions use: `per_head_cost`, `minimum_order`, `is_active` — field name mismatch
- `Vendor` type: `service_type`, `contact_phone`, `contact_email`, `preferred`, `active`
- But actions use: `vendor_type`, `phone`, `email`, `is_preferred`, `is_active` — field name mismatch

### Financial Logic
- `balanceDue = booking.final_payment_date ? 0 : total` — doesn't account for partial payments
- Balance due date calculated with raw `new Date()` — no London timezone handling
- `depositAmount = booking.deposit_amount ?? 250` — £250 hardcoded fallback in contract template

### Permission Architecture
- `requirePrivateBookingsPermission()` always checks action as a `PrivateBookingsManageAction` type but RBAC module is `'private_bookings'` — verify the string matches what DB expects
- `recordDepositPayment` and `recordFinalPayment` use `manage_deposits` permission — verify this exists in RBAC config
- `getPrivateBookingSmsQueue` uses `view_sms_queue` — verify this exists
- `approveSms` and `rejectSms` use `approve_sms` — verify
- `sendApprovedSms` uses `'send'` — very generic, verify it exists

### Audit Inconsistency
- `privateBookingActions.ts` uses `logAuditEvent()` (writes to global audit log)
- `contract/route.ts` writes directly to `private_booking_audit` table (booking-specific audit)
- Some actions (e.g. `updatePrivateBooking`, `updateBookingStatus`, `cancelPrivateBooking`) call no audit logging at all
