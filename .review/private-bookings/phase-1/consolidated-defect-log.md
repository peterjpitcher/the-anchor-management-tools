# Consolidated Defect Log — Private Bookings
**Generated**: 2026-03-07
**Agents**: Structural Mapper ✓ | Business Rules Auditor ✓ | Technical Architect ✓ | QA Specialist ✓

---

## CRITICAL — Actively Harming the Business Right Now

### DEF-001: Contract generation is completely broken for all users
- **Found by**: Tech Architect + QA (TC-002) + Business Rules Auditor
- **Root cause**: The contract API route (`contract/route.ts:22-26`) calls `supabase.rpc('user_has_permission', { p_action: 'generate_contracts' })` directly instead of the application's standard `checkUserPermission()`. The `generate_contracts` action exists in `src/types/rbac.ts` but must also exist as a row in the DB's `permissions` table. If that row is missing or the RPC call fails for any reason (session cookie not forwarded to RPC, RLS on permissions table, etc.), `hasPermission` is `null` or `false` — and the check `if (!hasPermission)` returns 403 to ALL users.
- **Why the redirect makes it worse**: `contract/page.tsx` does `window.location.href = /api/private-bookings/contract?bookingId=${id}`. This is a full browser navigation — it drops the Next.js auth cookie context. Whether the cookie is forwarded to the API route depends on same-origin behaviour, which it is (same domain), so cookie forwarding is fine. However, the **direct RPC call bypasses the app's permission layer entirely**, meaning any misconfiguration in the DB permissions table silently blocks all users.
- **Secondary cause**: The audit insert (`private_booking_audit.insert`) happens AFTER HTML is generated but BEFORE the HTML is returned. If the insert fails (e.g. `private_booking_audit` table doesn't exist, RLS blocks it, or `contract_version` column not yet in schema), the route returns HTTP 500 and the user sees "Failed to generate contract" even though the HTML was successfully generated in memory. No user ever sees the contract.
- **Tertiary cause**: `booking.contract_version + 1` — if `contract_version` is `null` in DB, JS computes `null + 1 = 1` (actually fine), BUT if somehow `contract_version` is `undefined` (type coercion from Supabase returning null), this yields `NaN`. The audit insert at line 72 would store `NaN` as the new version, which may violate a DB integer constraint and cause the audit insert to fail, triggering the 500 above.
- **Files**: `src/app/api/private-bookings/contract/route.ts:22-93`, `src/app/(authenticated)/private-bookings/[id]/contract/page.tsx:25-28`
- **TC**: TC-001, TC-002, TC-015, TC-016, TC-017
- **Business impact**: Nobody can generate a contract. This is the primary known failure.

### DEF-002: XSS injection in contract HTML — unescaped user input
- **Found by**: Tech Architect + QA (TC-018, TC-019, DEF-009, DEF-014)
- **Root cause**: `generateContractHTML` in `contract-template.ts` defines `escapeHtml()` (line 33) but does NOT apply it consistently to all user-supplied fields:
  - `customerName` (line 102) → used raw at lines 429, 706, 712, 718
  - `eventType` (line 109) → used raw at lines 440, 706
  - `booking.special_requirements` → used raw at line 447
  - `booking.accessibility_needs` → used raw at line 448
  - `item.description` for all item types → used raw at lines 480, 526, 570, 590
  - Only `contract_note` is correctly escaped via `formatPlainText()`
- **Impact**: Any user with `edit` permission can store `<script>alert(1)</script>` in event_type or item description, and it executes when any user opens the contract page. This is a stored XSS in a printed legal document.
- **Files**: `src/lib/contract-template.ts:102,109,429,440,447,448,480,526,570,590,706,712,718`
- **TC**: TC-018, TC-019

### DEF-003: recordDepositPayment passes NaN amount to database
- **Found by**: QA (TC-023, DEF-010) + Business Rules Auditor
- **Root cause**: `recordDepositPayment` at `privateBookingActions.ts:561` does `parseFloat(getString(formData, 'amount') as string)` — if `getString` returns `undefined`, this becomes `parseFloat(undefined as any)` = `NaN`. Unlike `recordFinalPayment` (which has a `Number.isFinite` guard at line 599), deposit has no such check. NaN is then passed to `PrivateBookingService.recordDeposit()` and inserted into the DB.
- **Files**: `src/app/actions/privateBookingActions.ts:561-564`
- **TC**: TC-023

---

## STRUCTURAL — Fragile; Will Break Under Edge Cases

### DEF-004: Balance due in contract ignores actual payments and explicit balance_due_date
- **Found by**: Business Rules Auditor + QA (TC-011, TC-012, DEF-004, DEF-005)
- **Root cause (A)**: `contract-template.ts:116` — `const balanceDue = booking.final_payment_date ? 0 : total`. This ignores partial payments already recorded in `private_booking_payments`. A customer who paid £500 of a £1,000 booking (without triggering `final_payment_date`) will see £1,000 balance due on their contract.
- **Root cause (B)**: `contract-template.ts:119-125` — Balance due DATE is always re-calculated as `event_date - 7 days`. The `booking.balance_due_date` field is NEVER read. If a manager explicitly set a custom due date on the booking, the contract shows the wrong date.
- **Files**: `src/lib/contract-template.ts:116,119-125`
- **TC**: TC-011, TC-012

### DEF-005: No status transition validation — invalid state changes are possible
- **Found by**: Business Rules Auditor + Structural Mapper
- **Root cause**: `PrivateBookingService.updateBookingStatus()` and `updateBookingStatus` server action perform no guard on the current state before applying the new one. A cancelled booking can be set back to `draft` or `confirmed`. A completed booking can be set back to any state.
- **Missing**: State machine: `draft → confirmed → completed | cancelled`. Reverse transitions should be blocked server-side.
- **Files**: `src/services/private-bookings.ts` (updateBookingStatus), `src/app/actions/privateBookingActions.ts:322-348`
- **TC**: TC-044

### DEF-006: recordBalancePayment race condition — double-payment can prevent fully-paid status
- **Found by**: Technical Architect
- **Root cause**: `recordBalancePayment` (service): (1) inserts payment row, (2) queries SUM of all payments, (3) calculates remaining balance, (4) if zero, sets `final_payment_date`. Steps 1-4 are not wrapped in a transaction. Two concurrent payments of £500 each on a £1,000 booking could both query step 2 before either's step 4 commits, both see £500 remaining, and neither sets `final_payment_date`. Booking stays in "balance outstanding" state indefinitely.
- **Files**: `src/services/private-bookings.ts` (recordBalancePayment section ~1515-1675)
- **TC**: TC-024

### DEF-007: Calendar event orphaned when calendar_event_id update fails after sync
- **Found by**: Technical Architect
- **Root cause**: `createBooking` in service: (1) RPC creates booking in DB, (2) calls `syncCalendarEvent()` → gets calendar event ID, (3) attempts to update booking row with `calendar_event_id`. If step 3 fails, the booking has `calendar_event_id = NULL` but a real Google Calendar event exists. When the booking is later cancelled or deleted, `deleteCalendarEvent` is called with `null` ID and silently no-ops — leaving an orphaned calendar event.
- **Files**: `src/services/private-bookings.ts` (~line 314-349)
- **TC**: N/A (not tested)

### DEF-008: Payment method not validated — invalid values persist to DB
- **Found by**: Business Rules Auditor + QA (TC-022, DEF-003 in QA report)
- **Root cause**: Both `recordDepositPayment` and `recordFinalPayment` cast the payment_method string with `as string` without validating it is one of `'cash' | 'card' | 'invoice'`. An undefined/empty/arbitrary value is inserted into DB unchecked.
- **Files**: `src/app/actions/privateBookingActions.ts:560,595`
- **TC**: TC-022

### DEF-009: TypeScript types don't match DB schema — silent runtime failures
- **Found by**: Technical Architect + Business Rules Auditor + Structural Mapper
- **Mismatches found**:
  - `VenueSpace` type: `rate_per_hour`, `minimum_hours`, `setup_fee`, `active` vs actions using `hire_cost`, `is_active`, `capacity` (no `capacity_seated`)
  - `CateringPackage` type: `cost_per_head`, `minimum_guests`, `active` vs actions using `per_head_cost`, `minimum_order`, `is_active`
  - `Vendor` type: `service_type`, `contact_phone`, `contact_email`, `preferred`, `active` vs actions using `vendor_type`, `phone`, `email`, `is_preferred`, `is_active`
- **Impact**: TypeScript won't catch these at compile time because the mismatched objects are passed through loose function signatures. At runtime, DB inserts use the wrong column names (undefined values → null in DB). Settings management (create/update spaces, packages, vendors) may silently insert empty/null data.
- **Files**: `src/types/private-bookings.ts:88-135`, `src/app/actions/privateBookingActions.ts:817-1179`
- **TC**: TC-061-TC-065

### DEF-010: generateContractHTML not wrapped in try-catch — any null field causes unhandled 500
- **Found by**: Technical Architect
- **Root cause**: `contract/route.ts:53-64` calls `generateContractHTML({ booking, logoUrl, companyDetails })` without a try-catch. Inside the template, operations like `booking.items?.reduce(...)`, `formatDate(booking.event_date)`, `formatTime(booking.start_time)` can throw if the booking has unexpected null/undefined shapes from the DB. Any throw here becomes an unhandled 500 with no useful error message.
- **Files**: `src/app/api/private-bookings/contract/route.ts:53`
- **TC**: TC-005

### DEF-011: Deposit recording auto-confirms booking without business rule validation
- **Found by**: Business Rules Auditor + Technical Architect
- **Root cause**: `recordDeposit()` in service unconditionally sets `status = 'confirmed'` when a deposit is received. It also clears `cancellation_reason`. Problems: (a) a deposit on an already-confirmed booking creates unnecessary status churn, (b) a deposit on a cancelled booking re-confirms it without warning, (c) clearing cancellation_reason on second deposit recording loses historical data.
- **Files**: `src/services/private-bookings.ts` (~line 1284-1290)
- **TC**: TC-021

### DEF-012: Audit logging absent for 7+ critical operations
- **Found by**: Business Rules Auditor
- **Missing audit logs for**:
  - `recordDeposit` — no audit event
  - `recordBalancePayment` — no audit event
  - `updateBooking` — no audit event (only `createBooking` and `deletePrivateBooking` are audited in actions)
  - `applyBookingDiscount` — no audit event
  - `extendHold` — no audit event
  - `expireBooking` (if it exists) — no audit event
  - `deletePrivateBooking` — audit called in action but NOT in service; if service is ever called directly, no audit
- **Files**: `src/app/actions/privateBookingActions.ts`, `src/services/private-bookings.ts`
- **TC**: N/A

---

## ENHANCEMENT — Should Exist But Doesn't

### DEF-013: Contract page redirect pattern is fragile
- **Found by**: Structural Mapper + Tech Architect
- **Issue**: `contract/page.tsx` uses `useEffect` + `window.location.href` to redirect to the API route. This pattern: (a) renders a spinner page first, (b) then navigates away completely — breaking browser back button, (c) any error from the API route shows as a blank white page with no navigation. A better pattern is a direct link/button to the API URL, or a server-side redirect.
- **Files**: `src/app/(authenticated)/private-bookings/[id]/contract/page.tsx`

### DEF-014: No hold expiry enforcement — expired draft bookings never cancelled
- **Found by**: Structural Mapper
- **Issue**: `hold_expiry` is set on draft bookings but there is no cron job or trigger to cancel expired drafts. They sit as `draft` indefinitely, blocking the calendar slot.

### DEF-015: No idempotency on deposit recording — double-click can record twice
- **Found by**: Technical Architect + QA (DEF-013 in QA report)
- **Issue**: `recordDeposit` has no duplicate guard. If a user double-submits the payment form, two deposit records may be created and `deposit_paid_date` is overwritten with the second timestamp.

### DEF-016: Contract HTML is not stored — no historical record
- **Found by**: Structural Mapper
- **Issue**: Every contract generation creates a new HTML document in memory and returns it. Nothing is stored. If the booking data changes after a contract was sent to the customer, regenerating "the same contract" produces different content. No audit trail of what the customer actually received.

### DEF-017: Booking completion has no defined code path
- **Found by**: Structural Mapper
- **Issue**: Status `'completed'` exists in the enum and UI but there is no explicit server action or business logic to transition a booking to completed. Users must manually set it via the status dropdown — which has no guards.

### DEF-018: console.error used instead of logger in service layer
- **Found by**: Technical Architect
- **Issue**: Multiple `console.error` calls in `src/services/private-bookings.ts` bypass the application's `logger` utility, losing structured logging, log levels, and any centralised error tracking.
- **Files**: `src/services/private-bookings.ts` (~lines 307, 341, 347, 384)
