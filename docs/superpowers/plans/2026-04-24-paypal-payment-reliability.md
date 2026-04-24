# PayPal Payment Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all PayPal payment flows so deposits are reliably captured, recorded, and reconciled — no more lost payments.

**Architecture:** Four independent fixes: (1) separate webhook IDs per route, (2) capture-on-return for the customer portal, (3) fix the staff return URL parameter, (4) reconciliation cron as the durable fallback. Each fix is independently deployable.

**Tech Stack:** Next.js 15 App Router, Supabase (admin client), PayPal Orders API v2, Vercel Cron

**Spec:** `docs/superpowers/specs/2026-04-24-paypal-payment-reliability-design.md`

---

### Task 1: Separate Webhook IDs Per Route (P0)

**Files:**
- Modify: `src/app/api/webhooks/paypal/private-bookings/route.ts:89`
- Modify: `src/app/api/webhooks/paypal/parking/route.ts` (webhook ID line)
- Modify: `src/app/api/webhooks/paypal/table-bookings/route.ts` (webhook ID line)
- Modify: `.env.example`

- [ ] **Step 1: Add new env vars to `.env.example`**

Add below the existing `PAYPAL_WEBHOOK_ID` line:

```
PAYPAL_WEBHOOK_ID=your_paypal_webhook_id                           # General PayPal webhook
PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID=                                # Private bookings webhook (falls back to PAYPAL_WEBHOOK_ID)
PAYPAL_PARKING_WEBHOOK_ID=                                         # Parking webhook (falls back to PAYPAL_WEBHOOK_ID)
PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID=                                  # Table bookings webhook (falls back to PAYPAL_WEBHOOK_ID)
```

- [ ] **Step 2: Update private-bookings webhook to use its own ID**

In `src/app/api/webhooks/paypal/private-bookings/route.ts`, change line 89:

```typescript
// Before:
const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim()

// After:
const webhookId = (process.env.PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID)?.trim()
```

- [ ] **Step 3: Update parking webhook**

In `src/app/api/webhooks/paypal/parking/route.ts`, find the equivalent `PAYPAL_WEBHOOK_ID` read and change to:

```typescript
const webhookId = (process.env.PAYPAL_PARKING_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID)?.trim()
```

- [ ] **Step 4: Update table-bookings webhook**

In `src/app/api/webhooks/paypal/table-bookings/route.ts`, find the equivalent `PAYPAL_WEBHOOK_ID` read and change to:

```typescript
const webhookId = (process.env.PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID || process.env.PAYPAL_WEBHOOK_ID)?.trim()
```

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

Expected: clean build, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/paypal/ .env.example
git commit -m "fix(paypal): use separate webhook IDs per route with fallback to shared ID"
```

> **Deploy note:** After deploying, set `PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID` in Vercel env vars to the correct webhook subscription ID from the PayPal dashboard. Until set, falls back to existing `PAYPAL_WEBHOOK_ID`.

---

### Task 2: Fix Staff Return URL Parameter (P0)

**Files:**
- Modify: `src/app/actions/privateBookingActions.ts:1710`
- Modify: `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:1613-1618`

- [ ] **Step 1: Fix the return URL in order creation**

In `src/app/actions/privateBookingActions.ts`, change line 1710:

```typescript
// Before:
returnUrl: `${appUrl}/private-bookings/${bookingId}?paypal_return=deposit&order_id=`,

// After:
returnUrl: `${appUrl}/private-bookings/${bookingId}?paypal_return=deposit`,
```

- [ ] **Step 2: Read PayPal's `token` parameter instead of `order_id`**

In `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`, find the useEffect around line 1612-1618. Change:

```typescript
// Before:
const paypalReturn = searchParams.get('paypal_return');
const orderId = searchParams.get('order_id');

if (paypalReturn !== 'deposit' || !orderId || paypalCaptureHandled) return;

// After:
const paypalReturn = searchParams.get('paypal_return');
// PayPal returns the order ID in the 'token' query parameter
const orderId = searchParams.get('token') || searchParams.get('order_id');

if (paypalReturn !== 'deposit' || !orderId || paypalCaptureHandled) return;
```

The `|| searchParams.get('order_id')` fallback handles any in-flight orders that were created with the old return URL format.

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/app/actions/privateBookingActions.ts src/app/'(authenticated)'/private-bookings/'[id]'/PrivateBookingDetailClient.tsx
git commit -m "fix(paypal): read PayPal token param on staff return instead of empty order_id"
```

---

### Task 3: Capture-on-Return for Customer Portal (P0)

**Files:**
- Create: `src/app/booking-portal/[token]/PayPalCaptureClient.tsx`
- Modify: `src/app/booking-portal/[token]/page.tsx:208-213`
- Create: `src/app/actions/portalPayPalActions.ts`
- Modify: `src/app/actions/privateBookingActions.ts:2000` (return URL)

- [ ] **Step 1: Update the customer return URL to include the order ID**

In `src/app/actions/privateBookingActions.ts`, change line 2000:

```typescript
// Before:
returnUrl: `${portalUrl}?payment_pending=1`,

// After:
returnUrl: `${portalUrl}?payment_pending=1`,
// Note: PayPal appends &token=ORDER_ID to the return URL automatically.
// The portal client component reads this to trigger capture.
```

No change needed here — PayPal automatically appends `?token=ORDER_ID` (or `&token=ORDER_ID` if query params exist). The portal client component will read it.

- [ ] **Step 2: Create the portal-safe capture server action**

Create `src/app/actions/portalPayPalActions.ts`:

```typescript
'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { capturePayPalPayment } from '@/lib/paypal'
import { verifyBookingToken } from '@/lib/private-bookings/booking-token'
import { logger } from '@/lib/logger'

/**
 * Capture a PayPal deposit payment using the booking portal token as authorisation.
 * This is the customer-facing equivalent of captureDepositPayment — no staff auth required.
 * The HMAC-signed portal token proves the caller has a valid link for this booking.
 */
export async function captureDepositPaymentByToken(
  portalToken: string,
  paypalOrderId: string
): Promise<{ success?: boolean; error?: string }> {
  // Verify the portal token — this IS the authorisation
  const bookingId = verifyBookingToken(portalToken)
  if (!bookingId) {
    return { error: 'Invalid booking link' }
  }

  if (!paypalOrderId || typeof paypalOrderId !== 'string') {
    return { error: 'Missing payment reference' }
  }

  const admin = createAdminClient()

  const { data: booking, error: fetchError } = await admin
    .from('private_bookings')
    .select('id, deposit_amount, deposit_paid_date, paypal_deposit_order_id, status')
    .eq('id', bookingId)
    .maybeSingle()

  if (fetchError) {
    logger.error('Portal capture: failed to load booking', {
      error: fetchError,
      metadata: { bookingId }
    })
    return { error: 'Unable to load booking details' }
  }

  if (!booking) {
    return { error: 'Booking not found' }
  }

  // Already paid — idempotent success
  if (booking.deposit_paid_date) {
    return { success: true }
  }

  // Verify the order ID matches what we stored
  if (booking.paypal_deposit_order_id !== paypalOrderId) {
    logger.error('Portal capture: order ID mismatch', {
      metadata: { bookingId, expected: booking.paypal_deposit_order_id, received: paypalOrderId }
    })
    return { error: 'Payment reference does not match this booking' }
  }

  try {
    const captureResult = await capturePayPalPayment(paypalOrderId)

    // Validate captured amount matches expected deposit
    const capturedAmount = parseFloat(captureResult.amount)
    const expectedAmount = Number(booking.deposit_amount ?? 0)
    if (expectedAmount > 0 && Math.abs(capturedAmount - expectedAmount) > 0.01) {
      logger.error('Portal capture: amount mismatch', {
        metadata: { bookingId, paypalOrderId, capturedAmount, expectedAmount }
      })
      return { error: 'Payment amount does not match the expected deposit. Please contact us.' }
    }

    // Record the deposit and transition status
    const statusUpdate: Record<string, unknown> =
      booking.status === 'draft'
        ? { status: 'confirmed', cancellation_reason: null }
        : {}

    const { data: updated, error: updateError } = await admin
      .from('private_bookings')
      .update({
        deposit_paid_date: new Date().toISOString(),
        deposit_payment_method: 'paypal',
        paypal_deposit_capture_id: captureResult.transactionId,
        ...statusUpdate,
        updated_at: new Date().toISOString(),
      })
      .eq('id', bookingId)
      .is('deposit_paid_date', null)
      .select('id')
      .maybeSingle()

    if (updateError) {
      logger.error('Portal capture: DB update failed', {
        error: updateError,
        metadata: { bookingId, captureId: captureResult.transactionId }
      })
      return { error: 'Payment was captured but we could not update your booking. Please contact us.' }
    }

    if (!updated) {
      // Zero rows updated — deposit was recorded by another path (webhook or staff)
      logger.info('Portal capture: deposit already recorded by another path', {
        metadata: { bookingId, captureId: captureResult.transactionId }
      })
      return { success: true }
    }

    // Audit log
    await admin.from('audit_logs').insert({
      action: 'paypal_deposit_captured_via_portal',
      entity_type: 'private_booking',
      entity_id: bookingId,
      metadata: {
        capture_id: captureResult.transactionId,
        order_id: paypalOrderId,
        amount: captureResult.amount,
      }
    })

    logger.info('Portal capture: deposit recorded successfully', {
      metadata: { bookingId, captureId: captureResult.transactionId }
    })

    return { success: true }
  } catch (error) {
    // PayPal capture can fail if already captured (e.g. by webhook) — check for COMPLETED status
    logger.error('Portal capture: PayPal capture failed', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { bookingId, paypalOrderId }
    })
    return { error: 'We could not process your payment. Please contact us for assistance.' }
  }
}
```

- [ ] **Step 3: Create the client component for portal capture**

Create `src/app/booking-portal/[token]/PayPalCaptureClient.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { captureDepositPaymentByToken } from '@/app/actions/portalPayPalActions'

interface PayPalCaptureClientProps {
  portalToken: string
  depositPaid: boolean
}

export function PayPalCaptureClient({ portalToken, depositPaid }: PayPalCaptureClientProps) {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'idle' | 'capturing' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [captureAttempted, setCaptureAttempted] = useState(false)

  useEffect(() => {
    // PayPal appends token=ORDER_ID to the return URL
    const paymentPending = searchParams.get('payment_pending')
    const paypalOrderId = searchParams.get('token')

    if (paymentPending !== '1' || !paypalOrderId || depositPaid || captureAttempted) return

    setCaptureAttempted(true)
    setStatus('capturing')

    captureDepositPaymentByToken(portalToken, paypalOrderId)
      .then((result) => {
        if (result.success) {
          setStatus('success')
          // Reload to show updated booking state from the server component
          setTimeout(() => window.location.replace(window.location.pathname), 1500)
        } else {
          setStatus('error')
          setErrorMessage(result.error || 'Something went wrong')
        }
      })
      .catch(() => {
        setStatus('error')
        setErrorMessage('Unable to confirm your payment. Please contact us.')
      })
  }, [searchParams, portalToken, depositPaid, captureAttempted])

  if (status === 'idle') return null

  if (status === 'capturing') {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 mb-4 text-sm text-blue-800">
        <strong>Processing your payment...</strong> Please wait while we confirm your deposit.
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 mb-4 text-sm text-green-800">
        <strong>Payment confirmed — thank you!</strong> Your deposit has been received and your booking is confirmed.
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 mb-4 text-sm text-red-800">
        <strong>Payment issue</strong> — {errorMessage} If you need help, please call us.
      </div>
    )
  }

  return null
}
```

- [ ] **Step 4: Integrate the client component into the portal page**

In `src/app/booking-portal/[token]/page.tsx`, add the import at the top (after existing imports):

```typescript
import { PayPalCaptureClient } from './PayPalCaptureClient'
```

Then replace the static payment_pending banner (lines 208-213):

```typescript
// Before:
{payment_pending === '1' && !depositPaid && (
  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 mb-4 text-sm text-blue-800">
    <strong>Payment received — thank you!</strong> Your deposit is being processed and this page will update shortly.
  </div>
)}

// After:
<PayPalCaptureClient portalToken={token} depositPaid={depositPaid} />
```

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/portalPayPalActions.ts src/app/booking-portal/'[token]'/PayPalCaptureClient.tsx src/app/booking-portal/'[token]'/page.tsx
git commit -m "feat(paypal): capture deposit on customer portal return instead of relying on webhook"
```

---

### Task 4: Payment Reconciliation Cron (P0)

**Files:**
- Create: `src/app/api/cron/paypal-deposit-reconciliation/route.ts`
- Modify: `vercel.json` (add cron entry)

- [ ] **Step 1: Create the reconciliation cron handler**

Create `src/app/api/cron/paypal-deposit-reconciliation/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPayPalOrder, capturePayPalPayment } from '@/lib/paypal'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Find all draft bookings with a PayPal order but no deposit recorded
  const { data: pendingBookings, error: queryError } = await admin
    .from('private_bookings')
    .select('id, paypal_deposit_order_id, deposit_amount, status')
    .not('paypal_deposit_order_id', 'is', null)
    .is('deposit_paid_date', null)
    .in('status', ['draft', 'confirmed'])
    .limit(20) // Process in batches to stay within function timeout

  if (queryError) {
    logger.error('PayPal reconciliation: failed to query pending bookings', { error: queryError })
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  if (!pendingBookings || pendingBookings.length === 0) {
    return NextResponse.json({ reconciled: 0, message: 'No pending PayPal deposits' })
  }

  const results: Array<{ bookingId: string; outcome: string }> = []

  for (const booking of pendingBookings) {
    const bookingId = booking.id
    const orderId = booking.paypal_deposit_order_id

    try {
      const order = await getPayPalOrder(orderId)
      const orderStatus: string = order.status

      if (orderStatus === 'COMPLETED') {
        // Already captured — record the deposit
        const captureId = order.purchase_units?.[0]?.payments?.captures?.[0]?.id ?? null
        const capturedAmount = order.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value ?? null

        const statusUpdate: Record<string, unknown> =
          booking.status === 'draft'
            ? { status: 'confirmed', cancellation_reason: null }
            : {}

        const { data: updated } = await admin
          .from('private_bookings')
          .update({
            deposit_paid_date: new Date().toISOString(),
            deposit_payment_method: 'paypal',
            paypal_deposit_capture_id: captureId,
            ...statusUpdate,
            updated_at: new Date().toISOString(),
          })
          .eq('id', bookingId)
          .is('deposit_paid_date', null)
          .select('id')
          .maybeSingle()

        if (updated) {
          await admin.from('audit_logs').insert({
            action: 'paypal_deposit_reconciled',
            entity_type: 'private_booking',
            entity_id: bookingId,
            metadata: { capture_id: captureId, order_id: orderId, amount: capturedAmount, source: 'reconciliation_cron' }
          })
          results.push({ bookingId, outcome: 'recorded_completed' })
        } else {
          results.push({ bookingId, outcome: 'already_recorded' })
        }

      } else if (orderStatus === 'APPROVED') {
        // Customer approved but capture never happened — capture now
        try {
          const captureResult = await capturePayPalPayment(orderId)

          const capturedAmount = parseFloat(captureResult.amount)
          const expectedAmount = Number(booking.deposit_amount ?? 0)
          if (expectedAmount > 0 && Math.abs(capturedAmount - expectedAmount) > 0.01) {
            logger.error('PayPal reconciliation: amount mismatch during capture', {
              metadata: { bookingId, orderId, capturedAmount, expectedAmount }
            })
            results.push({ bookingId, outcome: 'amount_mismatch' })
            continue
          }

          const statusUpdate: Record<string, unknown> =
            booking.status === 'draft'
              ? { status: 'confirmed', cancellation_reason: null }
              : {}

          const { data: updated } = await admin
            .from('private_bookings')
            .update({
              deposit_paid_date: new Date().toISOString(),
              deposit_payment_method: 'paypal',
              paypal_deposit_capture_id: captureResult.transactionId,
              ...statusUpdate,
              updated_at: new Date().toISOString(),
            })
            .eq('id', bookingId)
            .is('deposit_paid_date', null)
            .select('id')
            .maybeSingle()

          if (updated) {
            await admin.from('audit_logs').insert({
              action: 'paypal_deposit_reconciled',
              entity_type: 'private_booking',
              entity_id: bookingId,
              metadata: { capture_id: captureResult.transactionId, order_id: orderId, amount: captureResult.amount, source: 'reconciliation_cron_captured' }
            })
            results.push({ bookingId, outcome: 'captured_and_recorded' })
          } else {
            results.push({ bookingId, outcome: 'already_recorded' })
          }
        } catch (captureError) {
          logger.error('PayPal reconciliation: capture failed for approved order', {
            error: captureError instanceof Error ? captureError : new Error(String(captureError)),
            metadata: { bookingId, orderId }
          })
          results.push({ bookingId, outcome: 'capture_failed' })
        }

      } else if (orderStatus === 'VOIDED' || orderStatus === 'EXPIRED' || orderStatus === 'SAVED') {
        // Order expired or voided — clear the order ID so staff can resend
        await admin
          .from('private_bookings')
          .update({ paypal_deposit_order_id: null, updated_at: new Date().toISOString() })
          .eq('id', bookingId)
          .is('deposit_paid_date', null)

        await admin.from('audit_logs').insert({
          action: 'paypal_deposit_order_expired',
          entity_type: 'private_booking',
          entity_id: bookingId,
          metadata: { order_id: orderId, order_status: orderStatus, source: 'reconciliation_cron' }
        })

        results.push({ bookingId, outcome: `cleared_${orderStatus.toLowerCase()}` })

      } else {
        // CREATED, PAYER_ACTION_REQUIRED, etc. — customer hasn't completed approval yet
        results.push({ bookingId, outcome: `pending_${orderStatus.toLowerCase()}` })
      }
    } catch (error) {
      logger.error('PayPal reconciliation: failed to check order', {
        error: error instanceof Error ? error : new Error(String(error)),
        metadata: { bookingId, orderId }
      })
      results.push({ bookingId, outcome: 'error' })
    }
  }

  logger.info('PayPal deposit reconciliation completed', { metadata: { results } })
  return NextResponse.json({ reconciled: results.length, results })
}
```

- [ ] **Step 2: Add cron entry to `vercel.json`**

Add a new entry to the `crons` array in `vercel.json`, after the existing `reconcile-sms` entry:

```json
{
  "path": "/api/cron/paypal-deposit-reconciliation",
  "schedule": "*/15 * * * *"
}
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/paypal-deposit-reconciliation/route.ts vercel.json
git commit -m "feat(paypal): add reconciliation cron to capture and record missed deposits every 15min"
```

---

### Task 5: Harden Webhook Handler (P1)

**Files:**
- Modify: `src/app/api/webhooks/paypal/private-bookings/route.ts:353-367`

- [ ] **Step 1: Add zero-row UPDATE detection**

In `src/app/api/webhooks/paypal/private-bookings/route.ts`, replace the update block in `handleDepositCaptureCompleted` (lines 353-367):

```typescript
// Before:
  const { error: updateError } = await supabase
    .from('private_bookings')
    .update({
      deposit_paid_date: new Date().toISOString(),
      deposit_payment_method: 'paypal',
      paypal_deposit_capture_id: captureId,
      ...statusUpdate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .is('deposit_paid_date', null) // Guard against race with UI-side capture

  if (updateError) {
    throw new Error(`Failed to record private booking deposit from webhook: ${updateError.message}`)
  }

// After:
  const { data: updated, error: updateError } = await supabase
    .from('private_bookings')
    .update({
      deposit_paid_date: new Date().toISOString(),
      deposit_payment_method: 'paypal',
      paypal_deposit_capture_id: captureId,
      ...statusUpdate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bookingId)
    .is('deposit_paid_date', null) // Guard against race with UI-side capture
    .select('id')
    .maybeSingle()

  if (updateError) {
    throw new Error(`Failed to record private booking deposit from webhook: ${updateError.message}`)
  }

  if (!updated) {
    // Zero rows updated — deposit was already recorded by another path (portal capture, staff, or reconciliation cron)
    logger.info('Webhook deposit update matched zero rows — deposit already recorded by another path', {
      metadata: { bookingId, captureId }
    })
    return
  }
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/paypal/private-bookings/route.ts
git commit -m "fix(paypal): detect zero-row webhook update and skip false-positive audit log"
```

---

### Task 6: Integration Test — Verify Build and Types

**Files:** None new — verification only.

- [ ] **Step 1: Run full verification pipeline**

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Expected: all three pass cleanly.

- [ ] **Step 2: Run existing tests to check for regressions**

```bash
npm test
```

Expected: all existing tests pass. No new tests are needed for the webhook ID change (env var fallback) or the cron (which requires live PayPal API). The portal capture action and client component can be tested manually after deploy.

- [ ] **Step 3: Final commit if any lint/type fixes were needed**

```bash
git add -A
git commit -m "chore: fix lint/type issues from paypal reliability changes"
```

Only if there were issues to fix — skip if pipeline was clean.

---

## Deployment Sequence

1. **Deploy the code** — all tasks are independently safe; deploying them together is fine
2. **Set env vars in Vercel:**
   - Log into PayPal dashboard → Webhooks → find the subscription for `/api/webhooks/paypal/private-bookings`
   - Copy its Webhook ID → set as `PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID` in Vercel
   - Do the same for parking and table-bookings if they have separate subscriptions
3. **Verify within 15 minutes** — the reconciliation cron should pick up Sam Joy's booking if the PayPal order is still APPROVED
4. **Monitor `webhook_logs`** for the next PayPal delivery — should show `status: 'success'` instead of `signature_failed`

## Post-Deploy Verification

```sql
-- Check Sam Joy's booking is now confirmed
SELECT status, deposit_paid_date, deposit_payment_method, paypal_deposit_capture_id
FROM private_bookings WHERE id = '7fcba618-077c-4542-8830-889524218734';

-- Check reconciliation cron ran
SELECT action, entity_id, metadata, created_at
FROM audit_logs WHERE action LIKE 'paypal_deposit_reconcil%'
ORDER BY created_at DESC LIMIT 10;

-- Check webhook signature failures stopped
SELECT status, processed_at FROM webhook_logs
WHERE webhook_type = 'paypal' AND params->>'source' = 'private_bookings'
ORDER BY processed_at DESC LIMIT 5;
```
