# Remediation Plan — Private Bookings
**Status**: Awaiting user sign-off before implementation begins

---

## Group 1: CRITICAL — Fix immediately (actively broken)

### Fix 1.1 — Repair contract generation (DEF-001)
**Goal**: Users can generate a contract without hitting a 403 or 500.
**Changes**:
1. Replace the direct `supabase.rpc('user_has_permission', ...)` call in `contract/route.ts` with `checkUserPermission('private_bookings', 'generate_contracts')` — the same helper used everywhere else in the app.
2. Wrap the `generateContractHTML(...)` call in a try-catch that returns a 500 with a descriptive message on failure (DEF-010).
3. Restructure the post-generation steps so that a failing audit log or version update does NOT block the user from receiving the HTML:
   - Generate HTML ✓
   - Increment version + audit log in a single DB transaction (best effort)
   - If transaction fails: log the error server-side, **but still return the HTML**
   - Optionally add a warning header so the client knows the audit failed
4. Guard `contract_version` null arithmetic: `(booking.contract_version ?? 0) + 1`.
**Files**: `src/app/api/private-bookings/contract/route.ts`
**Depends on**: nothing
**Test cases**: TC-001, TC-002, TC-015, TC-016, TC-017

### Fix 1.2 — Escape all user input in contract HTML (DEF-002)
**Goal**: No XSS possible via any user-supplied field.
**Changes**: In `contract-template.ts`, apply `escapeHtml()` to every user-supplied string before interpolation:
- `customerName` → `escapeHtml(customerName)`
- `eventType` → `escapeHtml(eventType)`
- `booking.special_requirements` → `escapeHtml(booking.special_requirements)`
- `booking.accessibility_needs` → `escapeHtml(booking.accessibility_needs)`
- All `item.description` occurrences (space, catering, vendor, other item loops)
- Also sanitise `logoUrl` with `encodeURI()` before interpolating into the `<img src>` attribute
**Files**: `src/lib/contract-template.ts`
**Depends on**: nothing (independent of Fix 1.1)
**Test cases**: TC-018, TC-019

### Fix 1.3 — Add NaN guard to recordDepositPayment (DEF-003)
**Goal**: Invalid deposit amounts are rejected before reaching the DB.
**Changes**: In `privateBookingActions.ts:recordDepositPayment`, add `Number.isFinite` check on the parsed amount — same pattern already used in `recordFinalPayment` at line 599.
**Files**: `src/app/actions/privateBookingActions.ts`
**Depends on**: nothing
**Test cases**: TC-023

---

## Group 2: STRUCTURAL — Fix before next release

### Fix 2.1 — Correct balance due in contract (DEF-004)
**Goal**: Contract shows correct balance due amount (accounting for partial payments) and correct due date.
**Changes** in `contract-template.ts`:
1. Balance due amount: Use `booking.payments` sum if available, otherwise fall back to `total - (payments already recorded)`. The service already fetches payments — confirm the `PrivateBookingWithDetails` type includes a `payments` array and it's populated in the contract route's booking fetch. If not, add it to the select query.
2. Balance due date: Check `booking.balance_due_date` first; only fall back to `event_date - 7 days` if `balance_due_date` is null.
**Files**: `src/lib/contract-template.ts:116-125`, `src/app/api/private-bookings/contract/route.ts` (ensure `payments` is in the select)
**Depends on**: Fix 1.1 (contract route must be working)
**Test cases**: TC-011, TC-012

### Fix 2.2 — Validate payment method enum (DEF-008)
**Goal**: Only `'cash' | 'card' | 'invoice'` can be stored as payment method.
**Changes**: In `privateBookingActions.ts`, add validation in both `recordDepositPayment` and `recordFinalPayment` that `paymentMethod` is one of the allowed values. Return `{ error: 'Invalid payment method' }` otherwise.
**Files**: `src/app/actions/privateBookingActions.ts:560,595`
**Test cases**: TC-022

### Fix 2.3 — Add status transition guards (DEF-005)
**Goal**: Invalid status transitions (cancelled → confirmed, completed → draft etc.) are rejected.
**Changes**: In `PrivateBookingService.updateBookingStatus`, fetch current status and apply a transition matrix:
```
draft     → confirmed | cancelled ✓
confirmed → completed | cancelled ✓
completed → (nothing) ✗
cancelled → (nothing) ✗
```
Return an error if the transition is not in the allowed set.
**Files**: `src/services/private-bookings.ts`
**Test cases**: TC-044

### Fix 2.4 — Fix TypeScript types to match DB/action parameter names (DEF-009)
**Goal**: No silent field-name mismatches between types, actions, and DB.
**Changes**: Audit and correct the three type definitions:
- `VenueSpace`: align field names with what the DB migration actually defines and what `createVenueSpace`/`updateVenueSpace` pass
- `CateringPackage`: align `cost_per_head` vs `per_head_cost`, `minimum_guests` vs `minimum_order`, `active` vs `is_active`
- `Vendor`: align `service_type` vs `vendor_type`, `contact_phone`/`contact_email` vs `phone`/`email`, `preferred`/`active` vs `is_preferred`/`is_active`
First read the actual migration SQL to determine the canonical column names, then fix the type definitions and action call sites to match.
**Files**: `src/types/private-bookings.ts`, `src/app/actions/privateBookingActions.ts`
**Depends on**: nothing (type-only fix, no DB changes)
**Test cases**: TC-061–TC-065

### Fix 2.5 — Guard deposit auto-confirmation (DEF-011)
**Goal**: Recording a deposit on a cancelled or already-confirmed booking behaves correctly.
**Changes**: In `recordDeposit()` service method:
- Only change status to `'confirmed'` if current status is `'draft'`
- Do NOT clear `cancellation_reason` unconditionally — only clear it if transitioning from `draft` to `confirmed`
- Reject (or warn) if booking is already `cancelled`
**Files**: `src/services/private-bookings.ts`
**Test cases**: TC-021

### Fix 2.6 — Add audit logging for payment and discount operations (DEF-012)
**Goal**: Full audit trail on all financial mutations.
**Changes**: Add `logAuditEvent()` calls in `privateBookingActions.ts` for:
- `recordDepositPayment` (after success)
- `recordFinalPayment` (after success)
- `updatePrivateBooking` (after success)
- `applyBookingDiscount` (after success)
- `extendBookingHold` (after success)
**Files**: `src/app/actions/privateBookingActions.ts`
**Test cases**: N/A (auditing, not user-facing)

---

## Group 3: ENHANCEMENTS — Schedule separately

### Fix 3.1 — Improve contract page UX (DEF-013)
Replace the `useEffect` redirect pattern with a direct server-rendered link/button to the contract API URL. On error from the API, show a proper error page with navigation rather than a blank response.

### Fix 3.2 — Wrap balance payment in DB transaction (DEF-006)
Add an advisory lock or serialisable transaction to `recordBalancePayment` to prevent the race condition where two concurrent payments both fail to set `final_payment_date`.

### Fix 3.3 — Add deposit idempotency (DEF-015)
Add a check before recording a deposit: if `deposit_paid_date` is already set, confirm or reject rather than silently overwriting.

### Fix 3.4 — Hold expiry enforcement (DEF-014)
Add a cron job or DB trigger that automatically cancels draft bookings past their `hold_expiry` date.

### Fix 3.5 — Replace console.error with logger (DEF-018)
Replace all `console.error` in `src/services/private-bookings.ts` with the application `logger`.

---

## Implementation Order

```
Fix 1.1 (contract route — permission + try-catch + audit decoupling)
Fix 1.2 (XSS escaping — independent)
Fix 1.3 (deposit NaN guard — independent)
  ↓
Fix 2.1 (balance due amount + date — needs 1.1 working)
Fix 2.2 (payment method validation — independent)
Fix 2.3 (status transition guards — independent)
Fix 2.4 (type fixes — independent, but test 2.5 first to understand actual DB columns)
Fix 2.5 (deposit confirmation guard — independent)
Fix 2.6 (audit logging — independent)
  ↓
Group 3 (enhancements — no dependencies on above)
```
