# PayPal Table Booking Deposits — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Stripe deposit payments for table bookings (Sunday lunch + 7+ guests) with PayPal — collected inline at booking on the-anchor.pub, and via SMS link in AnchorManagementTools.

**Architecture:** All PayPal logic lives in AnchorManagementTools. The-Anchor.pub renders PayPal buttons and proxies two API calls. Both paths (inline on website, SMS link for phone bookings) share the same capture logic. The guest payment page at `/g/[token]/table-payment` is rebuilt for PayPal (SMS flow). The-Anchor.pub intercepts the `pending_payment` state and shows PayPal buttons inline instead of redirecting.

**Tech Stack:** Next.js 15 + Supabase (AnchorManagementTools), Next.js 14 (The-Anchor.pub), `@paypal/react-paypal-js`, existing `src/lib/paypal.ts` PayPal client.

**Spec:** `docs/superpowers/specs/2026-03-15-paypal-table-booking-deposits-design.md`

---

## File Map

### AnchorManagementTools — Create

| File | Purpose |
|---|---|
| `supabase/migrations/YYYYMMDD_table_bookings_paypal.sql` | Add `paypal_deposit_order_id`, `paypal_deposit_capture_id`, `deposit_amount` columns; add `paypal` to payment method enum |
| `src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts` | External API: create PayPal order for deposit |
| `src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts` | External API: capture PayPal order, confirm booking |
| `src/app/api/webhooks/paypal/table-bookings/route.ts` | Webhook safety net for dropped connections |
| `src/app/g/[token]/table-payment/TablePaymentClient.tsx` | Client component: PayPal buttons + hold expiry display |

### AnchorManagementTools — Modify

| File | Purpose |
|---|---|
| `src/app/api/table-bookings/route.ts` | Add `booking_id` + `deposit_amount` to `pending_payment` response |
| `src/app/g/[token]/table-payment/page.tsx` | Convert to server component that pre-creates order, passes data to client |
| `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx` | Add Deposit column to bookings list |
| `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx` | Add Payment section to detail view |

### AnchorManagementTools — Delete

| File | Reason |
|---|---|
| `src/app/g/[token]/table-payment/checkout/route.ts` | Replaced by PayPal flow |

### The-Anchor.pub — Create

| File | Purpose |
|---|---|
| `components/features/TableBooking/PayPalDepositSection.tsx` | Shared PayPal buttons component used by both booking forms |
| `app/api/table-bookings/paypal/create-order/route.ts` | Proxy: forwards to AnchorManagementTools create-order |
| `app/api/table-bookings/paypal/capture-order/route.ts` | Proxy: forwards to AnchorManagementTools capture-order |

### The-Anchor.pub — Modify

| File | Purpose |
|---|---|
| `components/features/TableBooking/ManagementTableBookingForm.tsx` | Replace redirect with PayPal inline payment |
| `package.json` | Add `@paypal/react-paypal-js` |

---

## Chunk 1: AnchorManagementTools — DB Migration + API Response Update

### Task 1: DB Migration

**Files:**
- Create: `supabase/migrations/YYYYMMDD_table_bookings_paypal.sql`
  (Use the next sequential timestamp after the latest existing migration — check `supabase/migrations/` for the highest timestamp and increment)

- [ ] **Step 1.1: Find latest migration timestamp**

```bash
ls supabase/migrations/ | sort | tail -5
```

Note the highest timestamp. Your new migration filename must sort after it.

- [ ] **Step 1.2: Create migration file**

```sql
-- supabase/migrations/YYYYMMDD_table_bookings_paypal.sql

-- Add PayPal deposit tracking columns
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS paypal_deposit_order_id TEXT,
  ADD COLUMN IF NOT EXISTS paypal_deposit_capture_id TEXT,
  ADD COLUMN IF NOT EXISTS deposit_amount INTEGER; -- stored in pence (£10/person = 1000)

-- Add paypal as a valid payment method
-- Note: In Postgres you cannot use IF NOT EXISTS with ALTER TYPE ADD VALUE.
-- Use a DO block to guard against running twice.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'paypal'
      AND enumtypid = (
        SELECT oid FROM pg_type WHERE typname = 'table_booking_payment_method'
      )
  ) THEN
    ALTER TYPE table_booking_payment_method ADD VALUE 'paypal';
  END IF;
END
$$;
```

- [ ] **Step 1.3: Apply migration locally**

```bash
npx supabase db push
```

Expected: migration applies without errors. Verify with:

```bash
npx supabase db push --dry-run
```

- [ ] **Step 1.4: Regenerate TypeScript types**

```bash
npx supabase gen types typescript --local > src/types/database.generated.ts
```

Verify that `paypal_deposit_order_id`, `paypal_deposit_capture_id`, `deposit_amount` appear in the `bookings` row type, and `paypal` appears in `table_booking_payment_method`.

- [ ] **Step 1.5: Commit**

```bash
git add supabase/migrations/ src/types/database.generated.ts
git commit -m "feat: add PayPal columns to bookings table"
```

---

### Task 2: Update `pending_payment` Response to Include `booking_id`

The-Anchor.pub needs the `booking_id` to call the PayPal create-order API. Currently the response only includes `next_step_url`. We add `booking_id` and `deposit_amount` to the response — `next_step_url` stays for the SMS flow.

**Files:**
- Modify: `src/app/api/table-bookings/route.ts`

- [ ] **Step 2.1: Read the current file**

```bash
cat src/app/api/table-bookings/route.ts
```

Find the section that builds the `pending_payment` response — it returns `{ state: 'pending_payment', next_step_url, hold_expires_at }` or similar.

- [ ] **Step 2.2: Add `booking_id` and `deposit_amount` to the response**

In the section that builds the response for `pending_payment` state, add:
- `booking_id`: the UUID of the newly created booking (already available from the RPC result)
- `deposit_amount`: `party_size * 10` in GBP as an integer

Example — find the response-building block and extend it:

```typescript
// Before (approximate — match to actual code):
return NextResponse.json({
  state: 'pending_payment',
  next_step_url: paymentUrl,
  hold_expires_at: rpcResult.hold_expires_at,
})

// After:
return NextResponse.json({
  state: 'pending_payment',
  next_step_url: paymentUrl,        // kept for SMS link flow
  hold_expires_at: rpcResult.hold_expires_at,
  booking_id: rpcResult.booking_id, // new — for inline PayPal flow
  deposit_amount: partySize * 10,   // new — GBP integer
})
```

> Note: `partySize` and `rpcResult.booking_id` should already be in scope at this point. If `booking_id` is not in the RPC result, search for `create_table_booking` or `create_sunday_lunch_booking` in `src/lib/table-bookings/bookings.ts` to see what fields the RPC returns, and update the DB function or service layer to expose it.

- [ ] **Step 2.3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Fix any type errors. If `booking_id` doesn't exist on the RPC result type, update `src/types/table-bookings.ts` or wherever `TableBookingRpcResult` is defined.

- [ ] **Step 2.4: Commit**

```bash
git add src/app/api/table-bookings/route.ts
git commit -m "feat: include booking_id and deposit_amount in pending_payment response"
```

---

### Task 3: External Create-Order Endpoint

**Files:**
- Create: `src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts`
- Create: `src/app/api/external/table-bookings/[id]/paypal/create-order/__tests__/route.test.ts`

- [ ] **Step 3.1: Write the failing tests first**

```typescript
// src/app/api/external/table-bookings/[id]/paypal/create-order/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/admin')
vi.mock('@/lib/paypal')
vi.mock('@/lib/audit')

const mockApiKeyCheck = vi.fn()
vi.mock('@/lib/api-auth', () => ({ withApiAuth: (handler: any) => handler }))
// Adjust mock path to match actual location of withApiAuth

describe('POST /api/external/table-bookings/[id]/paypal/create-order', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a PayPal order for a valid booking requiring a deposit', async () => {
    const { getDb } = await import('@/lib/supabase/admin')
    vi.mocked(getDb).mockResolvedValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({
          data: {
            id: 'booking-123',
            party_size: 8,
            deposit_status: 'Required',
            paypal_deposit_order_id: null,
          },
          error: null,
        }) }) }),
        update: () => ({ eq: () => ({ error: null }) }),
      }),
    } as any)

    const { createSimplePayPalOrder } = await import('@/lib/paypal')
    vi.mocked(createSimplePayPalOrder).mockResolvedValue({
      orderId: 'PAYPAL-ORDER-123',
      approvalUrl: 'https://paypal.com/...',
    })

    const req = new NextRequest('http://localhost/api/external/table-bookings/booking-123/paypal/create-order', {
      method: 'POST',
    })
    const res = await POST(req, { params: { id: 'booking-123' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.orderId).toBe('PAYPAL-ORDER-123')
  })

  it('returns existing orderId if order already created (idempotent)', async () => {
    const { getDb } = await import('@/lib/supabase/admin')
    vi.mocked(getDb).mockResolvedValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({
          data: {
            id: 'booking-123',
            party_size: 8,
            deposit_status: 'Required',
            paypal_deposit_order_id: 'EXISTING-ORDER',
          },
          error: null,
        }) }) }),
      }),
    } as any)

    const req = new NextRequest('http://localhost/...', { method: 'POST' })
    const res = await POST(req, { params: { id: 'booking-123' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.orderId).toBe('EXISTING-ORDER')
    const { createSimplePayPalOrder } = await import('@/lib/paypal')
    expect(createSimplePayPalOrder).not.toHaveBeenCalled()
  })

  it('returns 409 if deposit already paid', async () => {
    const { getDb } = await import('@/lib/supabase/admin')
    vi.mocked(getDb).mockResolvedValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({
          data: { id: 'booking-123', deposit_status: 'Paid', paypal_deposit_order_id: null },
          error: null,
        }) }) }),
      }),
    } as any)

    const req = new NextRequest('http://localhost/...', { method: 'POST' })
    const res = await POST(req, { params: { id: 'booking-123' } })

    expect(res.status).toBe(409)
  })

  it('returns 400 if deposit not required', async () => {
    const { getDb } = await import('@/lib/supabase/admin')
    vi.mocked(getDb).mockResolvedValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({
          data: { id: 'booking-123', deposit_status: 'Not Required', paypal_deposit_order_id: null },
          error: null,
        }) }) }),
      }),
    } as any)

    const req = new NextRequest('http://localhost/...', { method: 'POST' })
    const res = await POST(req, { params: { id: 'booking-123' } })

    expect(res.status).toBe(400)
  })

  it('returns 404 if booking not found', async () => {
    const { getDb } = await import('@/lib/supabase/admin')
    vi.mocked(getDb).mockResolvedValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({
          data: null,
          error: { message: 'not found' },
        }) }) }),
      }),
    } as any)

    const req = new NextRequest('http://localhost/...', { method: 'POST' })
    const res = await POST(req, { params: { id: 'booking-123' } })

    expect(res.status).toBe(404)
  })

  it('returns 502 if PayPal API fails', async () => {
    const { getDb } = await import('@/lib/supabase/admin')
    vi.mocked(getDb).mockResolvedValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({
          data: { id: 'booking-123', party_size: 8, deposit_status: 'Required', paypal_deposit_order_id: null },
          error: null,
        }) }) }),
      }),
    } as any)

    const { createSimplePayPalOrder } = await import('@/lib/paypal')
    vi.mocked(createSimplePayPalOrder).mockRejectedValue(new Error('PayPal unavailable'))

    const req = new NextRequest('http://localhost/...', { method: 'POST' })
    const res = await POST(req, { params: { id: 'booking-123' } })

    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 3.2: Run tests — confirm they fail**

```bash
npx vitest run src/app/api/external/table-bookings/booking-123/paypal/create-order/__tests__/route.test.ts
```

Expected: all tests fail with "Cannot find module" or similar.

- [ ] **Step 3.3: Implement the route**

Look at `src/app/api/external/create-booking/route.ts` first to understand the exact `withApiAuth` import path and usage pattern. Then implement:

```typescript
// src/app/api/external/table-bookings/[id]/paypal/create-order/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { withApiAuth } from '@/lib/api-auth'  // adjust path to match existing
import { getDb } from '@/lib/supabase/admin'
import { createSimplePayPalOrder } from '@/lib/paypal'
import { logAuditEvent } from '@/lib/audit'

export const POST = withApiAuth(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
  const bookingId = params.id

  const db = await getDb()

  // Fetch booking
  const { data: booking, error } = await db
    .from('bookings')
    .select('id, party_size, deposit_status, paypal_deposit_order_id')
    .eq('id', bookingId)
    .single()

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  if (booking.deposit_status === 'Paid') {
    return NextResponse.json({ error: 'Deposit already paid' }, { status: 409 })
  }

  if (booking.deposit_status === 'Not Required') {
    return NextResponse.json({ error: 'No deposit required for this booking' }, { status: 400 })
  }

  // Idempotent: return existing order if already created
  if (booking.paypal_deposit_order_id) {
    return NextResponse.json({ orderId: booking.paypal_deposit_order_id })
  }

  // Calculate amount server-side — never trust client
  const amountGbp = (booking.party_size * 10).toFixed(2)

  try {
    const { orderId } = await createSimplePayPalOrder({
      amount: amountGbp,
      currency: 'GBP',
      description: `Table booking deposit — ${booking.party_size} guests`,
      customId: bookingId,
      requestId: `tb-deposit-${bookingId}`,  // distinct from parking- prefix
    })

    // Store order ID
    await db
      .from('bookings')
      .update({
        paypal_deposit_order_id: orderId,
        deposit_amount: booking.party_size * 1000, // pence
      })
      .eq('id', bookingId)

    await logAuditEvent({
      operation_type: 'payment.order_created',
      resource_type: 'table_booking',
      metadata: { bookingId, orderId, amountGbp },
    })

    return NextResponse.json({ orderId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[PayPal create-order]', message)
    return NextResponse.json({ error: 'Payment provider unavailable' }, { status: 502 })
  }
})
```

> **Note:** Look at the `createSimplePayPalOrder` function in `src/lib/paypal.ts` to confirm the exact options interface. If `requestId` is not an option, you may need to pass it via a different mechanism or add it to the function's options.

- [ ] **Step 3.4: Run tests — confirm they pass**

```bash
npx vitest run src/app/api/external/table-bookings/
```

Expected: all 5 tests pass.

- [ ] **Step 3.5: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3.6: Commit**

```bash
git add src/app/api/external/table-bookings/
git commit -m "feat: add PayPal create-order endpoint for table booking deposits"
```

---

### Task 4: External Capture-Order Endpoint

**Files:**
- Create: `src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts`
- Create: `src/app/api/external/table-bookings/[id]/paypal/capture-order/__tests__/route.test.ts`

- [ ] **Step 4.1: Write the failing tests**

```typescript
// src/app/api/external/table-bookings/[id]/paypal/capture-order/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/admin')
vi.mock('@/lib/paypal')
vi.mock('@/lib/audit')
vi.mock('@/lib/api-auth', () => ({ withApiAuth: (handler: any) => handler }))

describe('POST /api/external/table-bookings/[id]/paypal/capture-order', () => {
  beforeEach(() => vi.clearAllMocks())

  it('captures payment and confirms booking', async () => {
    const { getDb } = await import('@/lib/supabase/admin')
    vi.mocked(getDb).mockResolvedValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({
          data: {
            id: 'booking-123',
            deposit_status: 'Required',
            paypal_deposit_order_id: 'ORDER-123',
            paypal_deposit_capture_id: null,
          },
          error: null,
        }) }) }),
        update: () => ({ eq: () => ({ error: null }) }),
      }),
    } as any)

    const { capturePayPalPayment } = await import('@/lib/paypal')
    vi.mocked(capturePayPalPayment).mockResolvedValue({
      captureId: 'CAPTURE-456',
      status: 'COMPLETED',
    })

    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify({ orderId: 'ORDER-123' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, { params: { id: 'booking-123' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('returns 400 if orderId does not match stored order', async () => {
    const { getDb } = await import('@/lib/supabase/admin')
    vi.mocked(getDb).mockResolvedValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({
          data: {
            id: 'booking-123',
            deposit_status: 'Required',
            paypal_deposit_order_id: 'ORDER-123',
            paypal_deposit_capture_id: null,
          },
          error: null,
        }) }) }),
      }),
    } as any)

    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify({ orderId: 'WRONG-ORDER' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, { params: { id: 'booking-123' } })

    expect(res.status).toBe(400)
  })

  it('is idempotent — returns success if already captured', async () => {
    const { getDb } = await import('@/lib/supabase/admin')
    vi.mocked(getDb).mockResolvedValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({
          data: {
            id: 'booking-123',
            deposit_status: 'Paid',
            paypal_deposit_order_id: 'ORDER-123',
            paypal_deposit_capture_id: 'CAPTURE-EXISTING',
          },
          error: null,
        }) }) }),
      }),
    } as any)

    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify({ orderId: 'ORDER-123' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, { params: { id: 'booking-123' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    const { capturePayPalPayment } = await import('@/lib/paypal')
    expect(capturePayPalPayment).not.toHaveBeenCalled()
  })

  it('returns 502 on PayPal capture failure', async () => {
    const { getDb } = await import('@/lib/supabase/admin')
    vi.mocked(getDb).mockResolvedValue({
      from: () => ({
        select: () => ({ eq: () => ({ single: () => ({
          data: {
            id: 'booking-123',
            deposit_status: 'Required',
            paypal_deposit_order_id: 'ORDER-123',
            paypal_deposit_capture_id: null,
          },
          error: null,
        }) }) }),
      }),
    } as any)

    const { capturePayPalPayment } = await import('@/lib/paypal')
    vi.mocked(capturePayPalPayment).mockRejectedValue(new Error('PayPal error'))

    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify({ orderId: 'ORDER-123' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, { params: { id: 'booking-123' } })

    expect(res.status).toBe(502)
  })
})
```

- [ ] **Step 4.2: Run tests — confirm they fail**

```bash
npx vitest run src/app/api/external/table-bookings/
```

- [ ] **Step 4.3: Implement the route**

```typescript
// src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withApiAuth } from '@/lib/api-auth'
import { getDb } from '@/lib/supabase/admin'
import { capturePayPalPayment } from '@/lib/paypal'
import { logAuditEvent } from '@/lib/audit'

const BodySchema = z.object({
  orderId: z.string().min(1),
})

export const POST = withApiAuth(async (
  request: NextRequest,
  { params }: { params: { id: string } }
) => {
  const bookingId = params.id

  const bodyRaw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(bodyRaw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'orderId is required' }, { status: 400 })
  }
  const { orderId } = parsed.data

  const db = await getDb()

  const { data: booking, error } = await db
    .from('bookings')
    .select('id, deposit_status, paypal_deposit_order_id, paypal_deposit_capture_id')
    .eq('id', bookingId)
    .single()

  if (error || !booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  }

  // Idempotent: already captured
  if (booking.paypal_deposit_capture_id) {
    return NextResponse.json({ success: true })
  }

  // Validate orderId matches what we stored
  if (booking.paypal_deposit_order_id !== orderId) {
    return NextResponse.json({ error: 'Order ID mismatch' }, { status: 400 })
  }

  try {
    const { captureId } = await capturePayPalPayment(orderId)

    // Atomic update: mark paid + confirm booking
    const { error: updateError } = await db
      .from('bookings')
      .update({
        deposit_status: 'Paid',
        payment_method: 'paypal',
        paypal_deposit_capture_id: captureId,
        status: 'confirmed',
      })
      .eq('id', bookingId)

    if (updateError) {
      // PayPal succeeded but DB failed — log for manual reconciliation
      console.error('[CRITICAL] PayPal captured but DB update failed', {
        bookingId,
        captureId,
        error: updateError.message,
      })
      await logAuditEvent({
        operation_type: 'payment.capture_local_update_failed',
        resource_type: 'table_booking',
        metadata: {
          bookingId,
          captureId,
          error: updateError.message,
          action_needed: 'Manual reconciliation required',
        },
      })
      return NextResponse.json({ error: 'Payment captured but booking update failed — team notified' }, { status: 502 })
    }

    await logAuditEvent({
      operation_type: 'payment.captured',
      resource_type: 'table_booking',
      metadata: { bookingId, captureId, orderId },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[PayPal capture-order]', message)
    await logAuditEvent({
      operation_type: 'payment.capture_failed',
      resource_type: 'table_booking',
      metadata: { bookingId, orderId, error: message },
    })
    return NextResponse.json({ error: 'Payment capture failed' }, { status: 502 })
  }
})
```

> **Note:** Confirm the exact return shape of `capturePayPalPayment()` in `src/lib/paypal.ts`. It may return `{ captureId }` or `{ id }` or similar. Adjust the destructuring accordingly.

- [ ] **Step 4.4: Run all tests**

```bash
npx vitest run src/app/api/external/table-bookings/
```

Expected: all tests pass.

- [ ] **Step 4.5: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4.6: Commit**

```bash
git add src/app/api/external/table-bookings/
git commit -m "feat: add PayPal capture-order endpoint for table booking deposits"
```

---

## Chunk 2: AnchorManagementTools — Webhook + Guest Payment Page

### Task 5: PayPal Webhook Handler

**Files:**
- Create: `src/app/api/webhooks/paypal/table-bookings/route.ts`
- Create: `src/app/api/webhooks/paypal/table-bookings/__tests__/route.test.ts`

- [ ] **Step 5.1: Read the private-bookings webhook for reference**

```bash
cat src/app/api/webhooks/paypal/private-bookings/route.ts
```

Note the pattern for:
- Signature verification call
- `webhook_logs` idempotency table usage
- The `verifyPayPalWebhook` parameters
- How `PAYPAL_WEBHOOK_ID` env var is used

- [ ] **Step 5.2: Write the failing tests**

```typescript
// src/app/api/webhooks/paypal/table-bookings/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase/admin')
vi.mock('@/lib/paypal')
vi.mock('@/lib/audit')

describe('POST /api/webhooks/paypal/table-bookings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 for invalid webhook signature', async () => {
    const { verifyPayPalWebhook } = await import('@/lib/paypal')
    vi.mocked(verifyPayPalWebhook).mockResolvedValue(false)

    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED' }),
    })
    const res = await POST(req)

    expect(res.status).toBe(401)
  })

  it('marks booking paid when PAYMENT.CAPTURE.COMPLETED received', async () => {
    const { verifyPayPalWebhook } = await import('@/lib/paypal')
    vi.mocked(verifyPayPalWebhook).mockResolvedValue(true)

    const { getDb } = await import('@/lib/supabase/admin')
    const mockUpdate = vi.fn().mockReturnValue({ eq: () => ({ error: null }) })
    vi.mocked(getDb).mockResolvedValue({
      from: (table: string) => {
        if (table === 'webhook_logs') {
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => ({ data: null, error: null }) }) }),
            insert: () => ({ error: null }),
          }
        }
        return {
          select: () => ({ eq: () => ({ single: () => ({
            data: { id: 'booking-123', paypal_deposit_capture_id: null },
            error: null,
          }) }) }),
          update: mockUpdate,
        }
      },
    } as any)

    const event = {
      id: 'EVT-001',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAPTURE-789',
        supplementary_data: { related_ids: { order_id: 'ORDER-123' } },
      },
    }
    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify(event),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalled()
  })

  it('returns 200 without reprocessing for duplicate webhook event', async () => {
    const { verifyPayPalWebhook } = await import('@/lib/paypal')
    vi.mocked(verifyPayPalWebhook).mockResolvedValue(true)

    const { getDb } = await import('@/lib/supabase/admin')
    vi.mocked(getDb).mockResolvedValue({
      from: (table: string) => {
        if (table === 'webhook_logs') {
          return {
            // Duplicate: event already logged
            select: () => ({ eq: () => ({ maybeSingle: () => ({
              data: { id: 'EVT-001' },
              error: null,
            }) }) }),
          }
        }
        return {}
      },
    } as any)

    const event = { id: 'EVT-001', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} }
    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify(event),
    })
    const res = await POST(req)

    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 5.3: Run tests — confirm they fail**

```bash
npx vitest run src/app/api/webhooks/paypal/table-bookings/
```

- [ ] **Step 5.4: Implement the webhook handler**

Model this closely on `src/app/api/webhooks/paypal/private-bookings/route.ts`. Key differences:
- Use `process.env.PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID` (not `PAYPAL_WEBHOOK_ID`)
- Look up booking by `paypal_deposit_order_id` (not private booking ID)
- Update `bookings` table (not `private_bookings`)

```typescript
// src/app/api/webhooks/paypal/table-bookings/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyPayPalWebhook } from '@/lib/paypal'
import { getDb } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/lib/audit'

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const headers = Object.fromEntries(request.headers.entries())

  // Verify webhook signature
  const webhookId = process.env.PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID
  if (!webhookId) {
    console.error('[Webhook] PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID not set')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const isValid = await verifyPayPalWebhook(headers, rawBody, webhookId)
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(rawBody)
  const eventId = event.id
  const eventType = event.event_type

  if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
    // Acknowledge but ignore other event types
    return NextResponse.json({ received: true })
  }

  const db = await getDb()

  // Idempotency check
  const { data: existing } = await db
    .from('webhook_logs')
    .select('id')
    .eq('id', eventId)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  // Log event (idempotency record)
  await db.from('webhook_logs').insert({ id: eventId, event_type: eventType, processed_at: new Date().toISOString() })

  const captureId = event.resource?.id
  const orderId = event.resource?.supplementary_data?.related_ids?.order_id

  if (!orderId || !captureId) {
    console.error('[Webhook] Missing orderId or captureId in event', eventId)
    return NextResponse.json({ received: true })
  }

  // Find booking by order ID
  const { data: booking, error } = await db
    .from('bookings')
    .select('id, paypal_deposit_capture_id')
    .eq('paypal_deposit_order_id', orderId)
    .single()

  if (error || !booking) {
    console.error('[Webhook] No booking found for orderId', orderId)
    return NextResponse.json({ received: true })
  }

  // Skip if already captured (duplicate event after DB update)
  if (booking.paypal_deposit_capture_id) {
    return NextResponse.json({ received: true, alreadyProcessed: true })
  }

  // Mark booking paid
  await db
    .from('bookings')
    .update({
      deposit_status: 'Paid',
      payment_method: 'paypal',
      paypal_deposit_capture_id: captureId,
      status: 'confirmed',
    })
    .eq('id', booking.id)

  await logAuditEvent({
    operation_type: 'payment.captured',
    resource_type: 'table_booking',
    metadata: { bookingId: booking.id, captureId, orderId, source: 'webhook' },
  })

  return NextResponse.json({ received: true })
}
```

> **Note:** Check `src/app/api/webhooks/paypal/private-bookings/route.ts` for the exact shape of the `webhook_logs` table insert. Match the column names exactly.

- [ ] **Step 5.5: Run tests**

```bash
npx vitest run src/app/api/webhooks/paypal/table-bookings/
```

Expected: all 3 tests pass.

- [ ] **Step 5.6: Add env var to `.env.example`**

```bash
# In .env.example, add:
# PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID=  # Register at https://developer.paypal.com/dashboard/webhooks
```

- [ ] **Step 5.7: Commit**

```bash
git add src/app/api/webhooks/paypal/table-bookings/ .env.example
git commit -m "feat: add PayPal webhook handler for table booking deposits"
```

---

### Task 6: Rebuild Guest Payment Page for PayPal

**Files:**
- Modify: `src/app/g/[token]/table-payment/page.tsx`
- Create: `src/app/g/[token]/table-payment/TablePaymentClient.tsx`
- Delete: `src/app/g/[token]/table-payment/checkout/route.ts`

- [ ] **Step 6.1: Read the current page and checkout files**

```bash
cat src/app/g/[token]/table-payment/page.tsx
cat src/app/g/[token]/table-payment/checkout/route.ts
```

Note: the current page handles `state=success` and `state=blocked` query params, shows hold expiry, and renders a form that POSTs to checkout. We need to preserve the hold expiry display and add abandoned-flow handling (`state=cancelled`).

- [ ] **Step 6.2: Create the client component**

```typescript
// src/app/g/[token]/table-payment/TablePaymentClient.tsx
'use client'

import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js'
import { useState } from 'react'

interface Props {
  orderId: string
  bookingRef: string
  depositAmount: number  // GBP integer (e.g. 80)
  partySize: number
  holdExpiresAt: string  // ISO string
  showAbandonedMessage: boolean
  captureAction: (orderId: string) => Promise<{ success: boolean; error?: string }>
}

export function TablePaymentClient({
  orderId,
  bookingRef,
  depositAmount,
  partySize,
  holdExpiresAt,
  showAbandonedMessage,
  captureAction,
}: Props) {
  const [state, setState] = useState<'idle' | 'paying' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const holdExpiry = new Date(holdExpiresAt)
  const isExpired = holdExpiry < new Date()

  if (isExpired) {
    return (
      <div className="text-center py-8">
        <p className="text-lg font-medium">Your booking hold has expired.</p>
        <p className="text-sm text-gray-600 mt-2">Please book again to secure your table.</p>
      </div>
    )
  }

  if (state === 'success') {
    return (
      <div className="text-center py-8">
        <div className="text-green-600 text-4xl mb-4">✓</div>
        <p className="text-xl font-semibold">Deposit paid — you're confirmed!</p>
        <p className="text-sm text-gray-600 mt-2">
          Booking ref: <span className="font-mono">{bookingRef}</span>
        </p>
        <p className="text-sm text-gray-600 mt-1">We've sent confirmation by SMS.</p>
      </div>
    )
  }

  return (
    <PayPalScriptProvider options={{ clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID! }}>
      <div className="space-y-4">
        {showAbandonedMessage && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
            No problem — your table is still held. Complete payment below to confirm your booking.
          </div>
        )}

        <div className="bg-gray-50 rounded p-4 space-y-1 text-sm">
          <p><span className="font-medium">Booking ref:</span> {bookingRef}</p>
          <p><span className="font-medium">Party size:</span> {partySize} guests</p>
          <p><span className="font-medium">Deposit:</span> £{depositAmount} (£10 per person)</p>
          <p className="text-gray-500 text-xs">
            Hold expires: {holdExpiry.toLocaleString('en-GB', { timeZone: 'Europe/London' })}
          </p>
        </div>

        {state === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
            {errorMessage || 'Payment failed. Please try again or call us.'}
          </div>
        )}

        <PayPalButtons
          style={{ layout: 'vertical', label: 'pay' }}
          disabled={state === 'paying'}
          createOrder={() => Promise.resolve(orderId)}
          onApprove={async () => {
            setState('paying')
            const result = await captureAction(orderId)
            if (result.success) {
              setState('success')
            } else {
              setErrorMessage(result.error ?? 'Payment failed')
              setState('error')
            }
          }}
          onError={(err) => {
            console.error('[PayPal]', err)
            setErrorMessage('Payment could not be processed. Please try again or call us.')
            setState('error')
          }}
          onCancel={() => {
            setState('idle')
          }}
        />
      </div>
    </PayPalScriptProvider>
  )
}
```

- [ ] **Step 6.3: Update the server page component**

Replace the current page with a server component that:
1. Validates the token and fetches booking data
2. Handles already-paid redirect
3. Pre-creates the PayPal order (or reuses existing)
4. Passes data to `TablePaymentClient`

```typescript
// src/app/g/[token]/table-payment/page.tsx
import { notFound, redirect } from 'next/navigation'
import { TablePaymentClient } from './TablePaymentClient'
import { getDb } from '@/lib/supabase/admin'
import { createSimplePayPalOrder } from '@/lib/paypal'
// Import your existing token validation utility — look at the current page for how it validates the token

interface Props {
  params: { token: string }
  searchParams: { state?: string }
}

export default async function TablePaymentPage({ params, searchParams }: Props) {
  // 1. Validate token and get booking
  // Copy this logic from the CURRENT page.tsx — it already handles token validation.
  // The token validation likely calls something like getBookingByGuestToken() or similar.
  // Preserve the existing rate limiting logic.
  const booking = await getBookingFromToken(params.token) // replace with actual call
  if (!booking) notFound()

  // 2. Already paid → redirect to confirmation
  if (booking.deposit_status === 'Paid') {
    redirect(`/booking-confirmed?ref=${booking.reference}`)
  }

  // 3. Create or reuse PayPal order
  let orderId = booking.paypal_deposit_order_id
  if (!orderId) {
    const db = await getDb()
    const amountGbp = (booking.party_size * 10).toFixed(2)
    const result = await createSimplePayPalOrder({
      amount: amountGbp,
      currency: 'GBP',
      description: `Table booking deposit — ${booking.party_size} guests`,
      customId: booking.id,
      requestId: `tb-deposit-${booking.id}`,
    })
    orderId = result.orderId
    await db
      .from('bookings')
      .update({ paypal_deposit_order_id: orderId, deposit_amount: booking.party_size * 1000 })
      .eq('id', booking.id)
  }

  // 4. Server action for capture (called from client on approve)
  async function captureDeposit(captureOrderId: string): Promise<{ success: boolean; error?: string }> {
    'use server'
    // Reuse the capture logic from the external endpoint
    // (or call the capture function directly — avoid HTTP round-trip)
    const db = await getDb()
    const { capturePayPalPayment } = await import('@/lib/paypal')
    try {
      const { captureId } = await capturePayPalPayment(captureOrderId)
      const { error } = await db
        .from('bookings')
        .update({
          deposit_status: 'Paid',
          payment_method: 'paypal',
          paypal_deposit_capture_id: captureId,
          status: 'confirmed',
        })
        .eq('id', booking.id)
      if (error) throw error
      return { success: true }
    } catch (err) {
      return { success: false, error: 'Capture failed' }
    }
  }

  return (
    <main className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-6">Secure your table</h1>
      <TablePaymentClient
        orderId={orderId}
        bookingRef={booking.reference}
        depositAmount={booking.party_size * 10}
        partySize={booking.party_size}
        holdExpiresAt={booking.hold_expires_at}
        showAbandonedMessage={searchParams.state === 'cancelled'}
        captureAction={captureDeposit}
      />
    </main>
  )
}
```

> **Important:** Read the CURRENT `page.tsx` carefully before replacing it. Preserve:
> - The existing token validation logic (how it looks up the booking from a raw token)
> - The rate limiting setup
> - Any existing layout/styling patterns (branding, nav)
>
> The above is a structural guide — adapt to match the actual patterns in the file.

- [ ] **Step 6.4: Delete the old checkout route**

```bash
rm src/app/g/[token]/table-payment/checkout/route.ts
```

- [ ] **Step 6.5: Install `@paypal/react-paypal-js` in AnchorManagementTools**

```bash
npm install @paypal/react-paypal-js
```

- [ ] **Step 6.6: Typecheck and build check**

```bash
npx tsc --noEmit
npm run build 2>&1 | head -50
```

Fix any errors before continuing.

- [ ] **Step 6.7: Commit**

```bash
git add src/app/g/[token]/table-payment/ package.json package-lock.json
git commit -m "feat: rebuild guest payment page with PayPal for table booking deposits"
```

---

## Chunk 3: AnchorManagementTools — Staff UI

### Task 7: Deposit Column in BOH Bookings List

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx`

- [ ] **Step 7.1: Read the current file**

```bash
cat src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx
```

Find:
- The column definitions (where `Status`, `Party`, etc. are rendered)
- How the booking data is typed
- The existing "Deposit outstanding" badge (around line 873)

- [ ] **Step 7.2: Add `deposit_status`, `payment_method` to the booking query**

Ensure the server action or data fetch that populates this list includes `deposit_status` and `payment_method`. These should already be fetched — verify and add if missing.

- [ ] **Step 7.3: Add a Deposit column**

Find the table column header row and add a **Deposit** header. Then in the row rendering, add:

```typescript
// After the existing Status cell, add:
<td className="px-3 py-2">
  {booking.deposit_status === 'Paid' && (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
      ● Paid · {booking.payment_method === 'paypal' ? 'PayPal' : 'Card'}
    </span>
  )}
  {booking.deposit_status === 'Required' && (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
      ⚠ Outstanding
    </span>
  )}
  {/* Not Required: render nothing */}
</td>
```

Remove or keep the old inline "Deposit outstanding" badge — either approach is fine; just avoid showing it twice.

- [ ] **Step 7.4: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 7.5: Commit**

```bash
git add src/app/(authenticated)/table-bookings/boh/BohBookingsClient.tsx
git commit -m "feat: add deposit status column to BOH table bookings list"
```

---

### Task 8: Payment Section in Booking Detail View

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx`

- [ ] **Step 8.1: Read the current file**

```bash
cat src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx
```

Find where other booking details (party size, date, etc.) are displayed. Identify a good place to insert a "Deposit" section.

- [ ] **Step 8.2: Ensure the booking fetch includes payment fields**

In the server component or action that loads booking data for this page, make sure `deposit_status`, `payment_method`, `paypal_deposit_capture_id`, `deposit_amount`, `party_size` are all selected.

- [ ] **Step 8.3: Add the payment section**

```typescript
{/* Deposit section — add near other booking metadata */}
{(booking.deposit_status === 'Required' || booking.deposit_status === 'Paid') && (
  <section className="border rounded-lg p-4 space-y-2">
    <h3 className="text-sm font-semibold text-gray-700">Deposit</h3>

    {booking.deposit_status === 'Paid' ? (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-green-700">
          <span className="text-base">●</span>
          <span className="text-sm font-medium">
            Paid via {booking.payment_method === 'paypal' ? 'PayPal' : 'Card'}
          </span>
          <span className="text-green-600">✓</span>
        </div>
        <p className="text-sm text-gray-600">
          £{(booking.deposit_amount ?? booking.party_size * 1000) / 100}
        </p>
        {booking.paypal_deposit_capture_id && (
          <p className="text-xs text-gray-400 font-mono">
            Capture ID: {booking.paypal_deposit_capture_id}
          </p>
        )}
      </div>
    ) : (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-amber-700">
          <span className="text-sm">⚠ Outstanding</span>
          <span className="text-sm font-medium">
            — £{booking.party_size * 10}
          </span>
        </div>
        {/* Optional: button to resend payment SMS */}
      </div>
    )}
  </section>
)}
```

- [ ] **Step 8.4: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 8.5: Commit**

```bash
git add src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx
git commit -m "feat: add payment status section to table booking detail view"
```

---

## Chunk 4: The-Anchor.pub — PayPal Integration

> Work in `/Users/peterpitcher/Cursor/OJ-The-Anchor.pub` for all tasks in this chunk.

### Task 9: Install PayPal SDK + Proxy Routes

**Files:**
- Modify: `package.json`
- Create: `app/api/table-bookings/paypal/create-order/route.ts`
- Create: `app/api/table-bookings/paypal/capture-order/route.ts`

- [ ] **Step 9.1: Install `@paypal/react-paypal-js`**

```bash
cd /Users/peterpitcher/Cursor/OJ-The-Anchor.pub
npm install @paypal/react-paypal-js
```

- [ ] **Step 9.2: Write failing tests for proxy routes**

```typescript
// app/api/table-bookings/paypal/create-order/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

// Mock fetch (the proxy makes an upstream fetch call)
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('POST /api/table-bookings/paypal/create-order', () => {
  beforeEach(() => vi.clearAllMocks())

  it('proxies valid request and returns orderId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ orderId: 'PAYPAL-ORDER-123' }),
    })

    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify({ bookingId: '550e8400-e29b-41d4-a716-446655440000' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.orderId).toBe('PAYPAL-ORDER-123')
  })

  it('returns 400 for missing bookingId', async () => {
    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 502 when upstream is unavailable', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'))

    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify({ bookingId: '550e8400-e29b-41d4-a716-446655440000' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)

    expect(res.status).toBe(502)
  })
})
```

```typescript
// app/api/table-bookings/paypal/capture-order/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '../route'
import { NextRequest } from 'next/server'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('POST /api/table-bookings/paypal/capture-order', () => {
  beforeEach(() => vi.clearAllMocks())

  it('proxies valid request and returns success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })

    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify({
        bookingId: '550e8400-e29b-41d4-a716-446655440000',
        orderId: 'ORDER-123',
      }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
  })

  it('returns 400 for missing bookingId or orderId', async () => {
    const req = new NextRequest('http://localhost/...', {
      method: 'POST',
      body: JSON.stringify({ bookingId: '550e8400-e29b-41d4-a716-446655440000' }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req)

    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 9.3: Run tests — confirm they fail**

```bash
npx vitest run app/api/table-bookings/paypal/
```

- [ ] **Step 9.4: Implement proxy routes**

```typescript
// app/api/table-bookings/paypal/create-order/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const BodySchema = z.object({
  bookingId: z.string().uuid(),
})

export async function POST(request: NextRequest) {
  const bodyRaw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(bodyRaw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'bookingId (UUID) is required' }, { status: 400 })
  }
  const { bookingId } = parsed.data

  const upstream = `${process.env.ANCHOR_API_BASE_URL}/api/external/table-bookings/${bookingId}/paypal/create-order`

  try {
    const response = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ANCHOR_API_KEY}`,
        'Content-Type': 'application/json',
      },
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Payment service unavailable' }, { status: 502 })
  }
}
```

```typescript
// app/api/table-bookings/paypal/capture-order/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const BodySchema = z.object({
  bookingId: z.string().uuid(),
  orderId: z.string().min(1),
})

export async function POST(request: NextRequest) {
  const bodyRaw = await request.json().catch(() => null)
  const parsed = BodySchema.safeParse(bodyRaw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'bookingId (UUID) and orderId are required' }, { status: 400 })
  }
  const { bookingId, orderId } = parsed.data

  const upstream = `${process.env.ANCHOR_API_BASE_URL}/api/external/table-bookings/${bookingId}/paypal/capture-order`

  try {
    const response = await fetch(upstream, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.ANCHOR_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ orderId }),
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status })
    }

    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ error: 'Payment service unavailable' }, { status: 502 })
  }
}
```

- [ ] **Step 9.5: Run tests**

```bash
npx vitest run app/api/table-bookings/paypal/
```

Expected: all tests pass.

- [ ] **Step 9.6: Commit**

```bash
git add app/api/table-bookings/paypal/ package.json package-lock.json
git commit -m "feat: add PayPal proxy routes and install @paypal/react-paypal-js"
```

---

### Task 10: PayPalDepositSection Component

**Files:**
- Create: `components/features/TableBooking/PayPalDepositSection.tsx`
- Create: `components/features/TableBooking/__tests__/PayPalDepositSection.test.tsx`

- [ ] **Step 10.1: Write the failing component tests**

```typescript
// components/features/TableBooking/__tests__/PayPalDepositSection.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PayPalDepositSection } from '../PayPalDepositSection'

// Mock @paypal/react-paypal-js
vi.mock('@paypal/react-paypal-js', () => ({
  PayPalScriptProvider: ({ children }: any) => <div>{children}</div>,
  PayPalButtons: ({ onApprove, onError }: any) => (
    <div>
      <button data-testid="paypal-approve" onClick={() => onApprove({})}>
        Pay with PayPal
      </button>
      <button data-testid="paypal-error" onClick={() => onError(new Error('fail'))}>
        Trigger Error
      </button>
    </div>
  ),
}))

// Mock fetch for API calls
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('PayPalDepositSection', () => {
  const defaultProps = {
    bookingId: '550e8400-e29b-41d4-a716-446655440000',
    depositAmount: 80,
    bookingSummary: 'Sunday 22 March · 1:00pm · 8 guests',
    onSuccess: vi.fn(),
    onError: vi.fn(),
    orderId: 'PAYPAL-ORDER-123',
  }

  beforeEach(() => vi.clearAllMocks())

  it('renders booking summary and deposit amount', () => {
    render(<PayPalDepositSection {...defaultProps} />)
    expect(screen.getByText('Sunday 22 March · 1:00pm · 8 guests')).toBeInTheDocument()
    expect(screen.getByText(/£80/)).toBeInTheDocument()
  })

  it('calls onSuccess after successful capture', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    })

    render(<PayPalDepositSection {...defaultProps} />)
    screen.getByTestId('paypal-approve').click()

    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalled()
    })
  })

  it('calls onError on PayPal error', async () => {
    render(<PayPalDepositSection {...defaultProps} />)
    screen.getByTestId('paypal-error').click()

    await waitFor(() => {
      expect(defaultProps.onError).toHaveBeenCalled()
    })
  })

  it('calls onError when capture API returns failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Capture failed' }),
    })

    render(<PayPalDepositSection {...defaultProps} />)
    screen.getByTestId('paypal-approve').click()

    await waitFor(() => {
      expect(defaultProps.onError).toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 10.2: Run tests — confirm they fail**

```bash
npx vitest run components/features/TableBooking/__tests__/PayPalDepositSection.test.tsx
```

- [ ] **Step 10.3: Implement the component**

```typescript
// components/features/TableBooking/PayPalDepositSection.tsx
'use client'

import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js'
import { useState } from 'react'

interface Props {
  bookingId: string
  orderId: string
  depositAmount: number    // GBP integer (e.g. 80)
  bookingSummary: string   // e.g. "Sunday 22 March · 1:00pm · 8 guests"
  onSuccess: () => void
  onError: (message: string) => void
}

export function PayPalDepositSection({
  bookingId,
  orderId,
  depositAmount,
  bookingSummary,
  onSuccess,
  onError,
}: Props) {
  const [isPaying, setIsPaying] = useState(false)

  async function handleApprove() {
    setIsPaying(true)
    try {
      const response = await fetch('/api/table-bookings/paypal/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, orderId }),
      })
      const data = await response.json()

      if (!response.ok || !data.success) {
        onError(data.error ?? 'Payment failed. Please try again.')
      } else {
        onSuccess()
      }
    } catch {
      onError('Payment could not be processed. Please try again or call us.')
    } finally {
      setIsPaying(false)
    }
  }

  return (
    <PayPalScriptProvider options={{ clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID! }}>
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
          <p className="font-medium">{bookingSummary}</p>
          <p>
            Deposit: <span className="font-semibold">£{depositAmount}</span>{' '}
            <span className="text-gray-500">(£10 per person)</span>
          </p>
        </div>

        <PayPalButtons
          style={{ layout: 'vertical', label: 'pay', shape: 'rect' }}
          disabled={isPaying}
          createOrder={() => Promise.resolve(orderId)}
          onApprove={handleApprove}
          onError={(err) => {
            console.error('[PayPal]', err)
            onError('Payment could not be processed. Please try again or call us.')
          }}
        />

        <p className="text-xs text-gray-500 text-center">
          Your card details are never shared with us. Powered by PayPal.
        </p>
      </div>
    </PayPalScriptProvider>
  )
}
```

- [ ] **Step 10.4: Run tests**

```bash
npx vitest run components/features/TableBooking/__tests__/PayPalDepositSection.test.tsx
```

Expected: all 4 tests pass.

- [ ] **Step 10.5: Commit**

```bash
git add components/features/TableBooking/PayPalDepositSection.tsx components/features/TableBooking/__tests__/PayPalDepositSection.test.tsx
git commit -m "feat: add PayPalDepositSection component"
```

---

### Task 11: Wire PayPal Into Booking Form

**Files:**
- Modify: `components/features/TableBooking/ManagementTableBookingForm.tsx`

> **Note:** The Sunday lunch form on the-anchor.pub routes to `/book-table?sunday_lunch=true` which uses `ManagementTableBookingForm`. There is no separate `SundayLunchBookingForm` on the website — so only one form needs updating.

- [ ] **Step 11.1: Read the form component around the `pending_payment` handling**

```bash
grep -n "pending_payment\|next_step_url\|cardRedirectInitiated\|window.location" components/features/TableBooking/ManagementTableBookingForm.tsx | head -30
```

Find the `useEffect` that currently calls `window.location.assign(result.next_step_url)`.

- [ ] **Step 11.2: Read lines around the `pending_payment` useEffect and result display**

```bash
# Find the line number of the pending_payment useEffect
grep -n "pending_payment" components/features/TableBooking/ManagementTableBookingForm.tsx
# Then read ±30 lines around it
```

- [ ] **Step 11.3: Update the form state and pending_payment handling**

Make these targeted changes:

**a) Add new state variables** (near other useState declarations):

```typescript
const [paypalOrderId, setPaypalOrderId] = useState<string | null>(null)
const [bookingIdForPayment, setBookingIdForPayment] = useState<string | null>(null)
const [depositAmountForPayment, setDepositAmountForPayment] = useState<number>(0)
const [paymentState, setPaymentState] = useState<'idle' | 'confirmed' | 'error'>('idle')
const [paymentError, setPaymentError] = useState<string | null>(null)
```

**b) Replace the `pending_payment` useEffect** — instead of redirecting, call the create-order API and store the orderId:

```typescript
// Replace the existing pending_payment useEffect with:
useEffect(() => {
  if (result?.state !== 'pending_payment') return
  if (!result.booking_id) return

  // Store booking data for PayPal
  setBookingIdForPayment(result.booking_id)
  setDepositAmountForPayment(result.deposit_amount ?? 0)

  // Create PayPal order
  fetch('/api/table-bookings/paypal/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId: result.booking_id }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.orderId) setPaypalOrderId(data.orderId)
    })
    .catch(err => {
      console.error('[PayPal create-order]', err)
    })
}, [result?.state, result?.booking_id])
```

**c) Add PayPal payment UI** — in the JSX where the form is rendered, add a section that shows when `result?.state === 'pending_payment'` and `paypalOrderId` is set:

Find the section where the confirmed/pending_payment states are rendered. Replace/augment the pending_payment display:

```typescript
{result?.state === 'pending_payment' && (
  <div className="space-y-4">
    <h2 className="text-xl font-semibold">Almost there — secure your table</h2>

    {paymentState === 'confirmed' ? (
      <BookingConfirmation booking={result} />  // or whatever confirmation component is used
    ) : paypalOrderId && bookingIdForPayment ? (
      <>
        {paymentState === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-800">
            {paymentError}
          </div>
        )}
        <PayPalDepositSection
          bookingId={bookingIdForPayment}
          orderId={paypalOrderId}
          depositAmount={depositAmountForPayment}
          bookingSummary={buildBookingSummary(result)}  // format date/time/guests — adapt to actual data shape
          onSuccess={() => setPaymentState('confirmed')}
          onError={(msg) => {
            setPaymentError(msg)
            setPaymentState('error')
          }}
        />
      </>
    ) : (
      <p className="text-sm text-gray-500">Loading payment…</p>
    )}
  </div>
)}
```

**d) Import `PayPalDepositSection`** at the top of the file:

```typescript
import { PayPalDepositSection } from './PayPalDepositSection'
```

- [ ] **Step 11.4: Remove the old redirect code**

Find and remove the `setCardRedirectInitiated(true)` + `window.location.assign(result.next_step_url)` redirect code. The SMS link flow no longer requires the website to redirect.

- [ ] **Step 11.5: Typecheck**

```bash
npx tsc --noEmit
```

Fix any type errors. The API response now includes `booking_id` and `deposit_amount` — ensure these are added to the TypeScript type for the booking API response (likely in `lib/table-bookings/types.ts` or wherever `TableBookingApiResponse` is defined).

- [ ] **Step 11.6: Build check**

```bash
npm run build 2>&1 | head -80
```

Fix any build errors.

- [ ] **Step 11.7: Commit**

```bash
git add components/features/TableBooking/ManagementTableBookingForm.tsx
git commit -m "feat: show PayPal deposit buttons inline after booking — remove redirect"
```

---

### Task 12: Final Checks + End-to-End Verification

- [ ] **Step 12.1: Run full test suite in AnchorManagementTools**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools
npm test
```

All tests must pass.

- [ ] **Step 12.2: Run full test suite in The-Anchor.pub**

```bash
cd /Users/peterpitcher/Cursor/OJ-The-Anchor.pub
npm test
```

All tests must pass.

- [ ] **Step 12.3: Lint both codebases**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npm run lint
cd /Users/peterpitcher/Cursor/OJ-The-Anchor.pub && npm run lint
```

Zero warnings in both.

- [ ] **Step 12.4: Build both codebases**

```bash
cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools && npm run build
cd /Users/peterpitcher/Cursor/OJ-The-Anchor.pub && npm run build
```

Both must build successfully.

- [ ] **Step 12.5: PayPal sandbox checklist**

Before deploying to production, verify in PayPal sandbox:

- [ ] Online booking flow (7+ guests): form shows PayPal buttons, payment completes, confirmation shown inline
- [ ] Online booking flow (Sunday lunch): same as above
- [ ] Small group booking: no deposit UI shown, direct confirmation
- [ ] Guest payment page (SMS flow): PayPal buttons render, capture confirms booking
- [ ] Abandoned PayPal (click cancel): "no problem, still held" message shown
- [ ] Already-paid booking: guest page redirects to confirmation, website shows confirmation directly
- [ ] Hold expired: guest page shows expiry message
- [ ] Deposit status shows in BOH list: unpaid = amber, paid = green with method
- [ ] Deposit section in booking detail: correct amount, capture ID shown for paid bookings

- [ ] **Step 12.6: Register PayPal webhook**

1. Go to PayPal Developer Dashboard → Webhooks
2. Create a new webhook pointing to: `https://your-domain.com/api/webhooks/paypal/table-bookings`
3. Subscribe to: `PAYMENT.CAPTURE.COMPLETED`
4. Copy the webhook ID → set `PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID` in Vercel env vars

- [ ] **Step 12.7: Deploy AnchorManagementTools first**

```bash
# Confirm migration applied in production Supabase before deploying
npx supabase db push
# Then deploy via Vercel or git push to main
```

- [ ] **Step 12.8: Deploy The-Anchor.pub**

Only after AnchorManagementTools is live and the external API endpoints are working.

- [ ] **Step 12.9: Final commit message on each repo**

```bash
# AnchorManagementTools
git log --oneline -10

# The-Anchor.pub
git log --oneline -10
```

Verify commit history is clean and logical.
