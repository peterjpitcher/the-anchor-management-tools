# Private Bookings Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 18 defects found in the /private-bookings section review, spanning broken contract generation, XSS vulnerabilities, payment validation gaps, missing audit logs, and type mismatches.

**Architecture:** Fixes are applied in three groups — Critical (actively broken, do first), Structural (fragile, do second), Enhancements (quality, do last). Groups within each tier are independent and can be implemented in any order. No new DB migrations are required for most fixes; type fixes are TypeScript-only.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase (PostgreSQL + RLS), Zod validation, `checkUserPermission` from `src/app/actions/rbac.ts`.

---

## Context & Key Files

| File | Role |
|------|------|
| `src/app/api/private-bookings/contract/route.ts` | API GET handler — generates HTML contract |
| `src/lib/contract-template.ts` | Generates the HTML string from booking data |
| `src/app/actions/privateBookingActions.ts` | All server actions for private bookings |
| `src/services/private-bookings.ts` | Business logic service layer |
| `src/types/private-bookings.ts` | TypeScript type definitions |
| `src/app/actions/rbac.ts` | `checkUserPermission(module, action)` — the standard permission helper |

**Permission helper signature** (`src/app/actions/rbac.ts:64`):
```typescript
export async function checkUserPermission(
  moduleName: ModuleName,
  action: ActionType,
  userId?: string
): Promise<boolean>
```
`'generate_contracts'` is a valid `ActionType` (confirmed in `src/types/rbac.ts:81`).

---

## GROUP 1 — CRITICAL (Fix First)

### Task 1: Fix contract generation — permission check, error handling, audit decoupling (DEF-001, DEF-010)

**Files:**
- Modify: `src/app/api/private-bookings/contract/route.ts` (full rewrite of the GET handler)

**Background:**
The route currently uses `supabase.rpc('user_has_permission', ...)` (line 22) instead of `checkUserPermission`. If the DB permission row is misconfigured, every user gets 403. Additionally, `generateContractHTML` is not wrapped in try-catch (line 53), and the audit insert + version update (lines 67-93) block HTML delivery — if either fails, the user sees a 500 even though the contract was successfully generated.

**Step 1: Understand current structure**

Read the file top-to-bottom to understand exactly what it does:
```
src/app/api/private-bookings/contract/route.ts
```
The structure is: auth check → permission check (lines 22-26, broken) → fetch booking → generateContractHTML (no try-catch) → audit insert (blocks delivery if fails) → version update (blocks delivery if fails) → return HTML.

**Step 2: Rewrite the route**

Replace the entire contents of `src/app/api/private-bookings/contract/route.ts` with:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { generateContractHTML } from '@/lib/contract-template'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const bookingId = searchParams.get('bookingId')

  if (!bookingId) {
    return new NextResponse('Booking ID required', { status: 400 })
  }

  const supabase = await createClient()

  // Check authentication
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // Check permissions using the application-standard helper (not direct RPC)
  const hasPermission = await checkUserPermission('private_bookings', 'generate_contracts')
  if (!hasPermission) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  // Fetch booking with all details needed for the contract
  const { data: booking, error } = await supabase
    .from('private_bookings')
    .select(`
      *,
      customer:customers(*),
      items:private_booking_items(
        *,
        space:venue_spaces(*),
        package:catering_packages(*),
        vendor:vendors(*)
      ),
      payments:private_booking_payments(*)
    `)
    .eq('id', bookingId)
    .single()

  if (error || !booking) {
    return new NextResponse('Booking not found', { status: 404 })
  }

  // Generate HTML — wrapped in try-catch so null/unexpected fields don't produce unhandled 500
  let html: string
  try {
    html = generateContractHTML({
      booking,
      logoUrl: '/logo-black.png',
      companyDetails: {
        name: 'Orange Jelly Limited, trading as The Anchor',
        registrationNumber: '10537179',
        vatNumber: 'GB315203647',
        address: 'The Anchor, Horton Road, Stanwell Moor Village, Surrey, TW19 6AQ',
        phone: '01753 682 707',
        email: 'manager@the-anchor.pub'
      }
    })
  } catch (templateError) {
    logger.error('Contract template generation failed', {
      error: templateError instanceof Error ? templateError : new Error(String(templateError)),
      metadata: { bookingId }
    })
    return new NextResponse('Failed to generate contract', { status: 500 })
  }

  // Audit log + version increment — best-effort: failure does NOT block HTML delivery
  const newVersion = (booking.contract_version ?? 0) + 1
  try {
    const { error: auditError } = await supabase.from('private_booking_audit').insert({
      booking_id: bookingId,
      action: 'contract_generated',
      performed_by: user.id,
      metadata: {
        contract_version: newVersion,
        ip_address: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip')
      }
    })
    if (auditError) {
      logger.error('Contract audit log failed (non-blocking)', {
        error: auditError,
        metadata: { bookingId, newVersion }
      })
    }

    const { error: versionError } = await supabase
      .from('private_bookings')
      .update({ contract_version: newVersion })
      .eq('id', bookingId)
    if (versionError) {
      logger.error('Contract version update failed (non-blocking)', {
        error: versionError,
        metadata: { bookingId, newVersion }
      })
    }
  } catch (sideEffectError) {
    logger.error('Contract side-effects failed (non-blocking)', {
      error: sideEffectError instanceof Error ? sideEffectError : new Error(String(sideEffectError)),
      metadata: { bookingId }
    })
  }

  // Return HTML regardless of audit/version update outcome
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
      'Content-Disposition': `inline; filename="contract-${booking.id.slice(0, 8)}.html"`,
    },
  })
}
```

**Step 3: Verify**

Open any booking detail page and click "Contract". You should see the contract HTML rendered in the browser instead of a 403 or 500.

If you still see 403: the `generate_contracts` permission row is missing from the DB permissions table for your user's role. Run in Supabase SQL editor:
```sql
-- Check if the permission exists
SELECT * FROM permissions WHERE module_name = 'private_bookings' AND action = 'generate_contracts';
-- If missing, insert it for the appropriate role
INSERT INTO permissions (module_name, action, role) VALUES ('private_bookings', 'generate_contracts', 'manager');
```

**Step 4: Commit**
```bash
git add src/app/api/private-bookings/contract/route.ts
git commit -m "fix: repair contract generation — use checkUserPermission, add try-catch, decouple audit from HTML delivery"
```

---

### Task 2: Fix XSS in contract HTML (DEF-002)

**Files:**
- Modify: `src/lib/contract-template.ts`

**Background:**
`generateContractHTML` defines `escapeHtml()` (line 33) but does NOT apply it to: `customerName`, `eventType`, `booking.special_requirements`, `booking.accessibility_needs`, and all `item.description` fields. Any of these could contain `<script>` tags injected by a user with edit permissions.

**Step 1: Identify all unescaped interpolations**

Open `src/lib/contract-template.ts`. Search for these strings, which are all currently raw (unescaped):
- Line 102: `const customerName = booking.customer_full_name || booking.customer_name || 'To be confirmed'`
- Line 109: `const eventType = booking.event_type || 'To be confirmed'`
- Line 429: `${customerName}` (customer name in info grid)
- Line 440: `${eventType}` (event type in info grid)
- Line 447: `${booking.special_requirements}` (special requirements block)
- Line 448: `${booking.accessibility_needs}` (accessibility needs block)
- Line 480: `${item.description}` (in the space items loop)
- Line 526: `${item.description}` (in the catering items loop)
- Line 570: `${item.description}` (in vendor items loop — uses `any`)
- Line 590: `${item.description}` (in other items loop — uses `any`)
- Lines 706, 712, 718: `${customerName}` used in the agreement section and signature

**Step 2: Add escaped variables**

After the `const contractNote = formatPlainText(booking.contract_note)` line (~line 117), add:

```typescript
// Pre-escaped variables for safe HTML interpolation
const safeCustomerName = escapeHtml(customerName)
const safeEventType = escapeHtml(eventType)
const safeSpecialRequirements = booking.special_requirements ? escapeHtml(booking.special_requirements) : null
const safeAccessibilityNeeds = booking.accessibility_needs ? escapeHtml(booking.accessibility_needs) : null
```

**Step 3: Replace all unescaped usages**

Replace every occurrence of the raw variables in the HTML template string:
- `${customerName}` → `${safeCustomerName}` (all occurrences: info grid, agreement section, signature)
- `${eventType}` → `${safeEventType}` (info grid, agreement section)
- `${booking.special_requirements}` → `${safeSpecialRequirements}`
- `${booking.accessibility_needs}` → `${safeAccessibilityNeeds}`

For item descriptions in the `.map()` loops, update each loop body:

Space items (line ~473):
```typescript
// Change item.description to:
${escapeHtml(item.description || '')}
```

Catering items (line ~519):
```typescript
${escapeHtml(item.description || '')}
```

Vendor items (line ~568):
```typescript
${escapeHtml(item.description || '')}
```

Other items (line ~590):
```typescript
${escapeHtml(item.description || '')}
```

Also fix `item.notes` wherever it appears inline in the template (search for `${item.notes}`) — apply `escapeHtml()`.

**Step 4: Verify**

Generate a contract for a booking where you temporarily set the event_type to `<b>BOLD</b>` via the edit form. The contract should display `<b>BOLD</b>` as literal text, not bold text.

**Step 5: Commit**
```bash
git add src/lib/contract-template.ts
git commit -m "fix: escape all user-supplied fields in contract HTML to prevent XSS"
```

---

### Task 3: Fix deposit amount NaN validation (DEF-003)

**Files:**
- Modify: `src/app/actions/privateBookingActions.ts`

**Background:**
`recordDepositPayment` (line 561) parses the amount with `parseFloat()` but has no `Number.isFinite()` guard. `recordFinalPayment` (line 597-600) already has the right pattern. Mirror it.

**Step 1: Locate the current code**

In `privateBookingActions.ts`, find `recordDepositPayment` (~line 549). The current amount parsing is:
```typescript
const amount = parseFloat(getString(formData, 'amount') as string)
```
There is no subsequent validation.

**Step 2: Add the guard**

Replace the amount parsing line with:
```typescript
const amountRaw = getString(formData, 'amount')
const amount = amountRaw ? parseFloat(amountRaw) : NaN

if (!Number.isFinite(amount) || amount <= 0) {
  return { success: false, error: 'Invalid deposit amount' }
}
```

**Step 3: Verify**

Submit the deposit form with no amount entered. Should return `{ success: false, error: 'Invalid deposit amount' }` and show an error toast rather than inserting NaN to DB.

**Step 4: Commit**
```bash
git add src/app/actions/privateBookingActions.ts
git commit -m "fix: add Number.isFinite guard to recordDepositPayment — mirrors existing pattern in recordFinalPayment"
```

---

## GROUP 2 — STRUCTURAL

### Task 4: Fix balance due in contract — amount and date (DEF-004)

**Files:**
- Modify: `src/lib/contract-template.ts`

**Background — two issues:**
1. `balanceDue = booking.final_payment_date ? 0 : total` ignores partial payments. The booking fetch (after Task 1) now includes `payments:private_booking_payments(*)`.
2. `balanceDueDate` is always recalculated as `event_date - 7 days`, ignoring the `booking.balance_due_date` field.

**Step 1: Fix the balance due AMOUNT**

Find the line (~116):
```typescript
const balanceDue = booking.final_payment_date ? 0 : total
```

Replace with:
```typescript
// Sum all recorded payments; if final_payment_date is set, balance is £0
const totalPaid = booking.final_payment_date
  ? total
  : (booking.payments || []).reduce((sum: number, p: { amount: number }) => {
      const paid = typeof p.amount === 'string' ? parseFloat(p.amount) : p.amount
      return sum + (Number.isFinite(paid) ? paid : 0)
    }, 0)
const balanceDue = Math.max(0, total - totalPaid)
```

**Step 2: Fix the balance due DATE**

Find the balance due date calculation (~line 119-125):
```typescript
let balanceDueDate = 'To be confirmed'
if (booking.event_date) {
  const eventDateObj = new Date(booking.event_date)
  const dueDate = new Date(eventDateObj.getTime() - (7 * 24 * 60 * 60 * 1000))
  balanceDueDate = formatDate(dueDate.toISOString())
}
```

Replace with:
```typescript
let balanceDueDate = 'To be confirmed'
if (booking.balance_due_date) {
  // Use the explicitly set balance due date first
  balanceDueDate = formatDate(booking.balance_due_date)
} else if (booking.event_date) {
  // Fall back to 7 days before event
  const eventDateObj = new Date(booking.event_date)
  const dueDate = new Date(eventDateObj.getTime() - (7 * 24 * 60 * 60 * 1000))
  balanceDueDate = formatDate(dueDate.toISOString())
}
```

**Step 3: Verify**

Generate a contract for a booking that has a partial payment recorded. The "Balance Due for Event" should show the remaining amount, not the full total. Also set an explicit `balance_due_date` on a booking via the edit form, regenerate the contract — the contract should show the custom date.

**Step 4: Commit**
```bash
git add src/lib/contract-template.ts
git commit -m "fix: contract balance due now reflects actual payments and respects explicit balance_due_date"
```

---

### Task 5: Validate payment method enum (DEF-008)

**Files:**
- Modify: `src/app/actions/privateBookingActions.ts`

**Background:** Both `recordDepositPayment` and `recordFinalPayment` cast `payment_method` as `string` without validating it is one of `'cash' | 'card' | 'invoice'`.

**Step 1: Add validation to `recordDepositPayment`**

After the amount validation added in Task 3, add:
```typescript
const VALID_PAYMENT_METHODS = ['cash', 'card', 'invoice'] as const
const paymentMethod = getString(formData, 'payment_method')
if (!paymentMethod || !VALID_PAYMENT_METHODS.includes(paymentMethod as typeof VALID_PAYMENT_METHODS[number])) {
  return { success: false, error: 'Invalid payment method' }
}
```

**Step 2: Add the same to `recordFinalPayment`**

Find the `paymentMethod` line in `recordFinalPayment` (~line 595):
```typescript
const paymentMethod = getString(formData, 'payment_method') as string
```
Replace with:
```typescript
const paymentMethod = getString(formData, 'payment_method')
if (!paymentMethod || !(['cash', 'card', 'invoice'] as const).includes(paymentMethod as 'cash' | 'card' | 'invoice')) {
  return { success: false, error: 'Invalid payment method' }
}
```

**Step 3: Commit**
```bash
git add src/app/actions/privateBookingActions.ts
git commit -m "fix: validate payment method against allowed enum in both deposit and balance payment actions"
```

---

### Task 6: Add status transition guards (DEF-005)

**Files:**
- Modify: `src/services/private-bookings.ts`

**Background:** `updateBookingStatus` (line 846) simply calls `updateBooking` with the new status — no guard on what transitions are valid. `cancelBooking` has its own guard, but the generic status update doesn't.

**Step 1: Locate `updateBookingStatus`**

In `src/services/private-bookings.ts`, find (line 846-848):
```typescript
static async updateBookingStatus(id: string, status: BookingStatus, performedByUserId?: string) {
  return this.updateBooking(id, { status }, performedByUserId);
}
```

**Step 2: Add transition guard**

Replace with:
```typescript
static async updateBookingStatus(id: string, status: BookingStatus, performedByUserId?: string) {
  const supabase = await createClient()
  const { data: current, error } = await supabase
    .from('private_bookings')
    .select('status')
    .eq('id', id)
    .single()

  if (error || !current) throw new Error('Booking not found')

  const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
    draft:     ['confirmed', 'cancelled'],
    confirmed: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  }

  const allowed = ALLOWED_TRANSITIONS[current.status as BookingStatus] ?? []
  if (!allowed.includes(status)) {
    throw new Error(
      `Cannot transition booking from '${current.status}' to '${status}'`
    )
  }

  return this.updateBooking(id, { status }, performedByUserId)
}
```

**Step 3: Verify**

Try changing a cancelled booking's status to "confirmed" via the UI — it should fail with an error toast. Changing draft → confirmed should still work.

**Step 4: Commit**
```bash
git add src/services/private-bookings.ts
git commit -m "fix: add status transition guard to updateBookingStatus — prevents invalid state reversals"
```

---

### Task 7: Fix TypeScript types to match DB and action parameters (DEF-009)

**Files:**
- Modify: `src/types/private-bookings.ts`

**Background:** Three type definitions have field names that don't match what the DB migrations define or what the server actions pass. This causes silent runtime failures where `undefined` values are inserted.

Before making changes, verify the actual DB column names by reading the relevant migrations:
- `supabase/migrations/20260502000000_private_booking_payments.sql` (for VenueSpace/Catering/Vendor columns)
- Look for `CREATE TABLE venue_spaces`, `CREATE TABLE catering_packages`, `CREATE TABLE vendors` in any migration

**Step 1: Check DB column names**

Search for the CREATE TABLE statements:
```bash
grep -r "CREATE TABLE venue_spaces\|CREATE TABLE catering_packages\|CREATE TABLE vendors" supabase/migrations/
```

Then read those migrations to confirm the exact column names. Compare against what the actions pass in `createVenueSpace` (~line 817 in privateBookingActions.ts), `createCateringPackage` (~line 886), `createVendor` (~line 1097).

**Step 2: Update `VenueSpace` interface**

The actions pass `{ capacity, capacity_standing, hire_cost, is_active }`. Update the interface to match whatever the DB actually defines. The likely correct version (based on actions) is:
```typescript
export interface VenueSpace {
  id: string
  name: string
  description?: string
  capacity: number           // was capacity_seated
  capacity_standing?: number
  hire_cost: number          // was rate_per_hour
  is_active: boolean         // was active
  display_order: number
  created_at: string
  updated_at: string
}
```
(Adjust based on what the migration actually defines — trust the migration over the type.)

**Step 3: Update `CateringPackage` interface**

The actions pass `{ per_head_cost, minimum_order, is_active }`. Update:
```typescript
export interface CateringPackage {
  id: string
  name: string
  description?: string
  serving_style?: PackageType
  category: 'food' | 'drink' | 'addon'
  pricing_model?: PricingModel
  per_head_cost: number      // was cost_per_head
  minimum_order?: number | null  // was minimum_guests
  maximum_guests?: number
  dietary_notes?: string
  is_active: boolean         // was active
  display_order: number
  created_at: string
  updated_at: string
}
```

**Step 4: Update `Vendor` interface**

The actions pass `{ vendor_type, phone, email, is_preferred, is_active }`. Update:
```typescript
export interface Vendor {
  id: string
  name: string
  company_name?: string
  vendor_type: VendorServiceType  // was service_type
  phone?: string                  // was contact_phone
  email?: string                  // was contact_email
  website?: string
  typical_rate?: string
  typical_rate_normalized?: string | null
  notes?: string
  is_preferred: boolean           // was preferred
  is_active: boolean              // was active
  created_at: string
  updated_at: string
}
```

**Step 5: Fix any TypeScript errors**

Run:
```bash
npm run typecheck
```

Fix any compile errors introduced by the type changes. Most will be in client components that access `vendor.active` — change those to `vendor.is_active`, `vendor.preferred` → `vendor.is_preferred`, etc.

**Step 6: Commit**
```bash
git add src/types/private-bookings.ts
git commit -m "fix: align VenueSpace, CateringPackage, Vendor types with actual DB column names and action parameters"
```

---

### Task 8: Fix deposit recording — guard against cancelled bookings, don't clear cancellation_reason (DEF-011)

**Files:**
- Modify: `src/services/private-bookings.ts`

**Background:** `recordDeposit` (line 1282-1290) unconditionally sets `status: 'confirmed'` and `cancellation_reason: null` regardless of current booking state. This means: (a) recording a deposit on a cancelled booking silently re-confirms it, (b) cancellation reason is cleared if another deposit is recorded.

**Step 1: Locate the update in `recordDeposit`**

Find (~line 1282-1294):
```typescript
const { data: updatedBooking, error } = await supabase
  .from('private_bookings')
  .update({
    deposit_paid_date: new Date().toISOString(),
    deposit_payment_method: method,
    deposit_amount: amount,
    status: 'confirmed',
    cancellation_reason: null,
    updated_at: new Date().toISOString()
  })
  .eq('id', bookingId)
```

**Step 2: Replace with guarded version**

Just before the update, after the booking fetch (line 1280), add a guard:
```typescript
if (booking.status === 'cancelled') {
  throw new Error('Cannot record a deposit on a cancelled booking')
}
if (booking.status === 'completed') {
  throw new Error('Cannot record a deposit on a completed booking')
}
```

Then update the `.update()` call to only change status if currently draft:
```typescript
const updatePayload: Record<string, unknown> = {
  deposit_paid_date: new Date().toISOString(),
  deposit_payment_method: method,
  deposit_amount: amount,
  updated_at: new Date().toISOString()
}

// Only transition to confirmed if currently draft; don't overwrite other states
// Don't clear cancellation_reason — it's historical data
if (booking.status === 'draft') {
  updatePayload.status = 'confirmed'
  updatePayload.cancellation_reason = null // Only clear on draft→confirmed transition
}

const { data: updatedBooking, error } = await supabase
  .from('private_bookings')
  .update(updatePayload)
  .eq('id', bookingId)
  .select()
  .maybeSingle()
```

**Step 3: Commit**
```bash
git add src/services/private-bookings.ts
git commit -m "fix: recordDeposit — block on cancelled/completed bookings, only auto-confirm from draft status"
```

---

### Task 9: Add audit logging for all financial operations (DEF-012)

**Files:**
- Modify: `src/app/actions/privateBookingActions.ts`

**Background:** Audit logging is missing for: `recordDepositPayment`, `recordFinalPayment`, `updatePrivateBooking`, `applyBookingDiscount`, `extendBookingHold`. `logAuditEvent` is already imported at the top of the file.

**Step 1: `recordDepositPayment` — add after the successful `result` return path**

In `recordDepositPayment`, after `const result = await PrivateBookingService.recordDeposit(...)`, add:
```typescript
await logAuditEvent({
  user_id: user?.id,
  operation_type: 'update',
  resource_type: 'private_booking',
  resource_id: bookingId,
  operation_status: 'success',
  metadata: { action: 'deposit_recorded', amount, payment_method: paymentMethod }
})
```

**Step 2: `recordFinalPayment` — same pattern**

After `const result = await PrivateBookingService.recordBalancePayment(...)`, add:
```typescript
await logAuditEvent({
  user_id: user?.id,
  operation_type: 'update',
  resource_type: 'private_booking',
  resource_id: bookingId,
  operation_status: 'success',
  metadata: { action: 'balance_payment_recorded', amount, payment_method: paymentMethod }
})
```

**Step 3: `updatePrivateBooking` — add after the service call succeeds**

In the try block, after `const booking = await PrivateBookingService.updateBooking(...)`, add:
```typescript
await logAuditEvent({
  user_id: user.id,
  operation_type: 'update',
  resource_type: 'private_booking',
  resource_id: id,
  operation_status: 'success',
})
```

**Step 4: `applyBookingDiscount` — add after service call succeeds**

After `await PrivateBookingService.applyBookingDiscount(bookingId, data)`, add:
```typescript
const supabase = await createClient()
const { data: { user } } = await supabase.auth.getUser()
await logAuditEvent({
  user_id: user?.id,
  operation_type: 'update',
  resource_type: 'private_booking',
  resource_id: bookingId,
  operation_status: 'success',
  metadata: { action: 'discount_applied', ...data }
})
```

**Step 5: `extendBookingHold` — add after service call succeeds**

After `const result = await PrivateBookingService.extendHold(...)`, add:
```typescript
await logAuditEvent({
  user_id: user?.id,
  operation_type: 'update',
  resource_type: 'private_booking',
  resource_id: bookingId,
  operation_status: 'success',
  metadata: { action: 'hold_extended', days }
})
```

**Step 6: Commit**
```bash
git add src/app/actions/privateBookingActions.ts
git commit -m "fix: add audit logging to deposit payment, balance payment, booking update, discount, and extend-hold actions"
```

---

## GROUP 3 — ENHANCEMENTS

### Task 10: Improve contract page redirect pattern (DEF-013)

**Files:**
- Modify: `src/app/(authenticated)/private-bookings/[id]/contract/page.tsx`

**Background:** The current page renders a spinner then uses `useEffect` + `window.location.href` to navigate to the API route. If the API returns an error, the user sees a blank white page with no navigation back. A direct link avoids the intermediate render entirely.

**Step 1: Replace `useEffect` redirect with server component + link**

Convert `contract/page.tsx` to a server component that immediately redirects:
```typescript
import { redirect } from 'next/navigation'

export default async function ContractPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/api/private-bookings/contract?bookingId=${id}`)
}
```

This is a server-side redirect — the spinner page is never rendered. If the API returns an error HTML page, the browser displays it with the back button intact.

**Step 2: Commit**
```bash
git add src/app/(authenticated)/private-bookings/[id]/contract/page.tsx
git commit -m "refactor: replace useEffect redirect on contract page with server-side redirect"
```

---

### Task 11: Replace `console.error` with `logger` in service layer (DEF-018)

**Files:**
- Modify: `src/services/private-bookings.ts`

**Step 1: Find all console.error calls**

Search in the file:
```
grep -n "console.error" src/services/private-bookings.ts
```

**Step 2: Replace each**

Pattern to replace:
```typescript
console.error('Some message', error)
```
With:
```typescript
logger.error('Some message', {
  error: error instanceof Error ? error : new Error(String(error))
})
```
`logger` is already imported at the top of the file (`import { logger } from '@/lib/logger'`).

**Step 3: Commit**
```bash
git add src/services/private-bookings.ts
git commit -m "chore: replace console.error with structured logger in private-bookings service"
```

---

### Task 12: Add deposit idempotency guard (DEF-015)

**Files:**
- Modify: `src/services/private-bookings.ts`

**Background:** `recordDeposit` can be called twice (double-submit), overwriting `deposit_paid_date` with a second timestamp. Add a guard to reject if already recorded.

**Step 1: Add check after booking fetch**

In `recordDeposit`, after the booking fetch and the cancelled/completed guards (added in Task 8), add:
```typescript
if (booking.deposit_paid_date) {
  // Deposit already recorded — return success without making changes
  // This makes the operation idempotent (safe to retry)
  return { success: true, alreadyRecorded: true }
}
```

**Step 2: Commit**
```bash
git add src/services/private-bookings.ts
git commit -m "fix: make recordDeposit idempotent — skip if deposit already recorded"
```

---

### Task 13: Add hold expiry enforcement cron (DEF-014)

**Files:**
- Create: `src/app/api/cron/private-booking-hold-expiry/route.ts`
- Modify: `vercel.json`

**Background:** Draft bookings with a `hold_expiry` in the past are never automatically cancelled. The service already has an `expireBooking` method — it just needs to be called on a schedule.

**Step 1: Investigate the existing expire method**

Search in `src/services/private-bookings.ts` for `expireBooking` to understand its signature. If it doesn't exist, check for similar methods.

**Step 2: Create the cron route**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()

  // Find all draft bookings whose hold_expiry has passed
  const { data: expiredBookings, error } = await db
    .from('private_bookings')
    .select('id, hold_expiry, customer_first_name')
    .eq('status', 'draft')
    .lt('hold_expiry', new Date().toISOString())

  if (error) {
    logger.error('Failed to fetch expired bookings', { error })
    return NextResponse.json({ error: 'DB error' }, { status: 500 })
  }

  let cancelled = 0
  for (const booking of expiredBookings || []) {
    const { error: updateError } = await db
      .from('private_bookings')
      .update({
        status: 'cancelled',
        cancellation_reason: 'Hold period expired',
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', booking.id)
      .eq('status', 'draft') // Safety: only cancel if still draft

    if (updateError) {
      logger.error('Failed to expire booking', { error: updateError, metadata: { bookingId: booking.id } })
    } else {
      cancelled++
    }
  }

  logger.info(`Hold expiry cron: cancelled ${cancelled} of ${expiredBookings?.length ?? 0} expired bookings`)
  return NextResponse.json({ cancelled, total: expiredBookings?.length ?? 0 })
}
```

**Step 3: Add to `vercel.json`**

In `vercel.json`, add to the `crons` array:
```json
{ "path": "/api/cron/private-booking-hold-expiry", "schedule": "0 6 * * *" }
```
(Runs daily at 6am.)

**Step 4: Commit**
```bash
git add src/app/api/cron/private-booking-hold-expiry/route.ts vercel.json
git commit -m "feat: add cron to auto-cancel draft bookings past hold_expiry date"
```

---

## Execution Order Summary

```
Task 1 — Contract route (DEF-001, DEF-010) ← MOST URGENT
Task 2 — XSS escaping (DEF-002)
Task 3 — Deposit NaN guard (DEF-003)
  ↓
Task 4 — Balance due in contract (DEF-004)
Task 5 — Payment method validation (DEF-008)
Task 6 — Status transition guards (DEF-005)
Task 7 — Type fixes (DEF-009) ← run typecheck after
Task 8 — Deposit guard (DEF-011)
Task 9 — Audit logging (DEF-012)
  ↓
Task 10 — Contract page redirect (DEF-013)
Task 11 — Replace console.error (DEF-018)
Task 12 — Deposit idempotency (DEF-015)
Task 13 — Hold expiry cron (DEF-014)
```

**Not planned** (require design decisions beyond code):
- DEF-006: Balance payment race condition (needs DB-level advisory lock or serialisable transaction — discuss first)
- DEF-007: Calendar orphan on sync failure (needs compensating cleanup logic — discuss first)
- DEF-016: Contract HTML storage (significant new feature — out of scope for remediation)
- DEF-017: Booking completion code path (business process question — what triggers completion?)
