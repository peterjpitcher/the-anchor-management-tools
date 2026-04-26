# PayPal Refunds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable super_admin staff to issue full/partial PayPal refunds and manual refunds across private bookings, table bookings, and parking, with customer notifications and webhook reconciliation.

**Architecture:** New `payment_refunds` table as single source of truth. Shared server actions in `refundActions.ts` with polymorphic `sourceType`/`sourceId`. Shared UI components (RefundDialog, RefundHistoryTable) used across all three domains. Fix existing `refundPayPalPayment()` for idempotency and security. Extend all three webhook handlers for refund events.

**Tech Stack:** Next.js 15 App Router, Supabase PostgreSQL, PayPal REST API v2, Microsoft Graph (email), Twilio (SMS), React 19, Tailwind CSS v4

**Spec:** `docs/superpowers/specs/2026-04-26-paypal-refunds-design.md`

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/20260626000001_payment_refunds.sql` | New table, RPC, columns, permissions |
| Modify | `src/lib/paypal.ts:298-341` | Fix refund function (idempotency, remove note_to_payer, return full status) |
| Create | `src/app/actions/refundActions.ts` | Server actions: processPayPalRefund, processManualRefund, getRefundHistory |
| Create | `src/lib/refund-notifications.ts` | Email/SMS notification logic for refunds |
| Create | `src/components/ui-v2/refunds/RefundDialog.tsx` | Shared refund modal component |
| Create | `src/components/ui-v2/refunds/RefundHistoryTable.tsx` | Shared refund history display |
| Modify | `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx` | Add refund button + dialog + history |
| Modify | `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx` | Add refund button + dialog + history |
| Modify | `src/app/(authenticated)/parking/ParkingClient.tsx` | Add refund button + dialog + history |
| Create | `src/lib/paypal-refund-webhook.ts` | Shared refund webhook handler for all three domains |
| Modify | `src/app/api/webhooks/paypal/private-bookings/route.ts` | Add refund event handling, fix routing |
| Modify | `src/app/api/webhooks/paypal/table-bookings/route.ts` | Add refund event handling |
| Modify | `src/app/api/webhooks/paypal/parking/route.ts` | Integrate with payment_refunds, remove booking cancellation |
| Create | `src/app/actions/__tests__/refundActions.test.ts` | Server action tests |
| Create | `src/lib/__tests__/refund-notifications.test.ts` | Notification tests |

---

### Task 1: Database Migration — `payment_refunds` Table, RPC, and Columns

**Files:**
- Create: `supabase/migrations/20260626000001_payment_refunds.sql`

This migration creates everything the feature needs at the database level in one atomic step.

- [ ] **Step 1: Create the migration file**

```sql
-- payment_refunds table
CREATE TABLE IF NOT EXISTS public.payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL CHECK (source_type IN ('private_booking', 'table_booking', 'parking')),
  source_id UUID NOT NULL,
  paypal_capture_id TEXT,
  paypal_refund_id TEXT,
  paypal_request_id UUID,
  paypal_status TEXT CHECK (paypal_status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  paypal_status_details TEXT,
  refund_method TEXT NOT NULL CHECK (refund_method IN ('paypal', 'cash', 'bank_transfer', 'other')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  original_amount NUMERIC(10,2) NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  initiated_by UUID REFERENCES auth.users(id),
  initiated_by_type TEXT NOT NULL DEFAULT 'staff' CHECK (initiated_by_type IN ('staff', 'system')),
  notification_status TEXT CHECK (notification_status IN ('email_sent', 'sms_sent', 'skipped', 'failed')),
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_payment_refunds_source ON public.payment_refunds (source_type, source_id);
CREATE UNIQUE INDEX idx_payment_refunds_paypal_refund_id ON public.payment_refunds (paypal_refund_id) WHERE paypal_refund_id IS NOT NULL;
CREATE INDEX idx_payment_refunds_paypal_capture_id ON public.payment_refunds (paypal_capture_id) WHERE paypal_capture_id IS NOT NULL;

-- RLS
ALTER TABLE public.payment_refunds ENABLE ROW LEVEL SECURITY;

-- Service role only — all access through server actions
CREATE POLICY "Service role full access on payment_refunds"
  ON public.payment_refunds
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Refundable balance RPC with advisory lock
CREATE OR REPLACE FUNCTION public.calculate_refundable_balance(
  p_source_type TEXT,
  p_source_id UUID,
  p_original_amount NUMERIC(10,2)
) RETURNS NUMERIC(10,2) AS $$
DECLARE
  v_total_reserved NUMERIC(10,2);
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext(p_source_type || ':' || p_source_id::text)
  );

  SELECT COALESCE(SUM(amount), 0)
  INTO v_total_reserved
  FROM public.payment_refunds
  WHERE source_type = p_source_type
    AND source_id = p_source_id
    AND status IN ('completed', 'pending');

  RETURN p_original_amount - v_total_reserved;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add deposit_refund_status to private_bookings
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS deposit_refund_status TEXT
  CHECK (deposit_refund_status IN ('partially_refunded', 'refunded'));

-- Add deposit_refund_status to table_bookings
ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS deposit_refund_status TEXT
  CHECK (deposit_refund_status IN ('partially_refunded', 'refunded'));

-- Add refund_status to parking_booking_payments
ALTER TABLE public.parking_booking_payments
  ADD COLUMN IF NOT EXISTS refund_status TEXT
  CHECK (refund_status IN ('partially_refunded', 'refunded'));

-- Seed refund permission for super_admin across the three modules
-- Uses the existing permissions table pattern
INSERT INTO public.permissions (role_id, module_name, action)
SELECT r.id, m.module_name, 'refund'
FROM public.roles r
CROSS JOIN (
  VALUES ('private_bookings'), ('table_bookings'), ('parking')
) AS m(module_name)
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;
```

- [ ] **Step 2: Verify the migration applies cleanly**

Run: `npx supabase db push --dry-run`
Expected: No errors. If the permissions seed fails due to different table structure, check the actual roles/permissions schema and adjust.

- [ ] **Step 3: Apply the migration**

Run: `npx supabase db push`
Expected: Migration applied successfully.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260626000001_payment_refunds.sql
git commit -m "feat(refunds): add payment_refunds table, RPC, and domain columns"
```

---

### Task 2: Fix `refundPayPalPayment()` — Idempotency, Security, and Status

**Files:**
- Modify: `src/lib/paypal.ts:298-341`
- Create: `src/lib/__tests__/paypal-refund.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/paypal-refund.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock retry to pass through
vi.mock('../retry', () => ({
  retry: vi.fn((fn: () => Promise<any>) => fn()),
  RetryConfigs: { api: {} },
}))

// Mock getPayPalConfig and getAccessToken
vi.mock('../paypal', async (importOriginal) => {
  const original = await importOriginal<typeof import('../paypal')>()
  return {
    ...original,
    // We'll test refundPayPalPayment directly — mock its internal dependencies
  }
})

describe('refundPayPalPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Set env vars for PayPal config
    process.env.PAYPAL_CLIENT_ID = 'test-client-id'
    process.env.PAYPAL_CLIENT_SECRET = 'test-secret'
    process.env.PAYPAL_ENVIRONMENT = 'sandbox'
  })

  it('should send PayPal-Request-Id header for idempotency', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      // Mock access token response
      new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
    ).mockResolvedValueOnce(
      // Mock refund response
      new Response(JSON.stringify({
        id: 'REFUND-123',
        status: 'COMPLETED',
        amount: { value: '10.00', currency_code: 'GBP' },
      }), { status: 201 })
    )

    const { refundPayPalPayment } = await import('../paypal')
    await refundPayPalPayment('CAPTURE-ABC', 10, 'test-request-id-uuid')

    const refundCall = fetchSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('/refund')
    )
    expect(refundCall).toBeDefined()
    const headers = (refundCall![1] as RequestInit).headers as Record<string, string>
    expect(headers['PayPal-Request-Id']).toBe('test-request-id-uuid')
  })

  it('should NOT include note_to_payer in request body', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
    ).mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: 'REFUND-123',
        status: 'COMPLETED',
        amount: { value: '10.00', currency_code: 'GBP' },
      }), { status: 201 })
    )

    const { refundPayPalPayment } = await import('../paypal')
    await refundPayPalPayment('CAPTURE-ABC', 10, 'req-id')

    const refundCall = global.fetch.mock?.calls?.find((call: any) =>
      typeof call[0] === 'string' && call[0].includes('/refund')
    ) as any
    const body = JSON.parse(refundCall[1].body)
    expect(body.note_to_payer).toBeUndefined()
  })

  it('should return paypal_status and status_details', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
    ).mockResolvedValueOnce(
      new Response(JSON.stringify({
        id: 'REFUND-456',
        status: 'PENDING',
        status_details: { reason: 'ECHECK' },
        amount: { value: '25.00', currency_code: 'GBP' },
      }), { status: 201 })
    )

    const { refundPayPalPayment } = await import('../paypal')
    const result = await refundPayPalPayment('CAPTURE-DEF', 25, 'req-id-2')

    expect(result.refundId).toBe('REFUND-456')
    expect(result.status).toBe('PENDING')
    expect(result.statusDetails).toBe('ECHECK')
    expect(result.amount).toBe('25.00')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/paypal-refund.test.ts`
Expected: FAIL — current function doesn't accept requestId param or return statusDetails.

- [ ] **Step 3: Update `refundPayPalPayment()` in `src/lib/paypal.ts`**

Replace lines 297-341 with:

```typescript
// Process refund
export async function refundPayPalPayment(
  captureId: string,
  amount: number,
  requestId: string
): Promise<{
  refundId: string;
  status: string;
  statusDetails?: string;
  amount: string;
}> {
  const accessToken = await getAccessToken();
  const { baseUrl } = getPayPalConfig();

  const refundData = {
    amount: {
      value: amount.toFixed(2),
      currency_code: 'GBP',
    },
  };

  const response = await retry(
    async () => fetch(`${baseUrl}/v2/payments/captures/${captureId}/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'PayPal-Request-Id': requestId,
      },
      body: JSON.stringify(refundData),
    }),
    RetryConfigs.api
  );

  if (!response.ok) {
    const error = await response.json();
    console.error('PayPal refund error:', error);
    throw new Error(
      error?.details?.[0]?.description || error?.message || 'Failed to process PayPal refund'
    );
  }

  const data = await response.json();
  return {
    refundId: data.id,
    status: data.status,
    statusDetails: data.status_details?.reason,
    amount: data.amount.value,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/paypal-refund.test.ts`
Expected: All 3 tests PASS.

- [ ] **Step 5: Run existing tests to check for regressions**

Run: `npm test`
Expected: All existing tests still pass. (Nothing else calls `refundPayPalPayment` yet.)

- [ ] **Step 6: Commit**

```bash
git add src/lib/paypal.ts src/lib/__tests__/paypal-refund.test.ts
git commit -m "fix(paypal): add idempotency header, remove note_to_payer, return full refund status"
```

---

### Task 3: Refund Notification Service

**Files:**
- Create: `src/lib/refund-notifications.ts`
- Create: `src/lib/__tests__/refund-notifications.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/refund-notifications.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/email/emailService', () => ({
  sendEmail: vi.fn(),
}))
vi.mock('@/lib/twilio', () => ({
  sendSMS: vi.fn(),
}))

import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'

describe('sendRefundNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should send email when email is available', async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: true })

    const { sendRefundNotification } = await import('../refund-notifications')
    const result = await sendRefundNotification({
      customerName: 'John Smith',
      email: 'john@example.com',
      phone: '+447123456789',
      amount: 50.00,
    })

    expect(result).toBe('email_sent')
    expect(sendEmail).toHaveBeenCalledWith({
      to: 'john@example.com',
      subject: 'Refund Confirmation — The Anchor',
      html: expect.stringContaining('£50.00'),
    })
    expect(sendSMS).not.toHaveBeenCalled()
  })

  it('should fall back to SMS when email fails', async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: 'Graph error' })
    vi.mocked(sendSMS).mockResolvedValueOnce({ success: true })

    const { sendRefundNotification } = await import('../refund-notifications')
    const result = await sendRefundNotification({
      customerName: 'Jane Doe',
      email: 'jane@example.com',
      phone: '+447987654321',
      amount: 25.50,
    })

    expect(result).toBe('sms_sent')
    expect(sendSMS).toHaveBeenCalledWith(
      '+447987654321',
      expect.stringContaining('£25.50'),
      expect.any(Object)
    )
  })

  it('should fall back to SMS when no email provided', async () => {
    vi.mocked(sendSMS).mockResolvedValueOnce({ success: true })

    const { sendRefundNotification } = await import('../refund-notifications')
    const result = await sendRefundNotification({
      customerName: 'No Email',
      email: null,
      phone: '+447111222333',
      amount: 10.00,
    })

    expect(result).toBe('sms_sent')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('should return skipped when no contact info available', async () => {
    const { sendRefundNotification } = await import('../refund-notifications')
    const result = await sendRefundNotification({
      customerName: 'Ghost',
      email: null,
      phone: null,
      amount: 10.00,
    })

    expect(result).toBe('skipped')
  })

  it('should return failed when both channels fail', async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: 'fail' })
    vi.mocked(sendSMS).mockResolvedValueOnce({ success: false, error: 'fail' })

    const { sendRefundNotification } = await import('../refund-notifications')
    const result = await sendRefundNotification({
      customerName: 'Unlucky',
      email: 'test@test.com',
      phone: '+447000000000',
      amount: 15.00,
    })

    expect(result).toBe('failed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/refund-notifications.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the notification service**

Create `src/lib/refund-notifications.ts`:

```typescript
import { sendEmail } from '@/lib/email/emailService'
import { sendSMS } from '@/lib/twilio'

type NotificationStatus = 'email_sent' | 'sms_sent' | 'skipped' | 'failed'

interface RefundNotificationParams {
  customerName: string
  email: string | null
  phone: string | null
  amount: number
}

function formatAmount(amount: number): string {
  return `£${amount.toFixed(2)}`
}

function buildEmailHtml(customerName: string, amount: string): string {
  return `
    <p>Hi ${customerName},</p>
    <p>We've initiated a refund of ${amount} to your original payment method.</p>
    <p>Please allow up to 5 business days for this to appear in your account.</p>
    <p>If you have any questions, please don't hesitate to contact us.</p>
    <p>Kind regards,<br/>The Anchor Team</p>
  `.trim()
}

function buildSmsBody(customerName: string, amount: string): string {
  return `Hi ${customerName}, we've initiated a refund of ${amount} to your original payment method. Please allow up to 5 business days for this to appear. — The Anchor`
}

export async function sendRefundNotification(
  params: RefundNotificationParams
): Promise<NotificationStatus> {
  const amount = formatAmount(params.amount)

  // Try email first
  if (params.email) {
    const emailResult = await sendEmail({
      to: params.email,
      subject: 'Refund Confirmation — The Anchor',
      html: buildEmailHtml(params.customerName, amount),
    })
    if (emailResult.success) return 'email_sent'
  }

  // Fall back to SMS
  if (params.phone) {
    const smsResult = await sendSMS(
      params.phone,
      buildSmsBody(params.customerName, amount),
      { skipDuplicateCheck: true }
    )
    if (smsResult.success) return 'sms_sent'
  }

  // No contact info or both failed
  if (!params.email && !params.phone) return 'skipped'
  return 'failed'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/refund-notifications.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/refund-notifications.ts src/lib/__tests__/refund-notifications.test.ts
git commit -m "feat(refunds): add refund notification service with email/SMS fallback"
```

---

### Task 4: Server Actions — `processPayPalRefund`, `processManualRefund`, `getRefundHistory`

**Files:**
- Create: `src/app/actions/refundActions.ts`
- Create: `src/app/actions/__tests__/refundActions.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/app/actions/__tests__/refundActions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock all external dependencies
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))
vi.mock('@/lib/paypal', () => ({
  refundPayPalPayment: vi.fn(),
}))
vi.mock('@/lib/refund-notifications', () => ({
  sendRefundNotification: vi.fn(),
}))
vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))
vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { refundPayPalPayment } from '@/lib/paypal'
import { sendRefundNotification } from '@/lib/refund-notifications'
import { checkUserPermission } from '@/app/actions/rbac'

function mockSupabaseChain(returnData: any = null, returnError: any = null) {
  const chain: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
    single: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
    order: vi.fn().mockResolvedValue({ data: returnData ? [returnData] : [], error: returnError }),
    rpc: vi.fn().mockResolvedValue({ data: returnData, error: returnError }),
  }
  return chain
}

describe('refundActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(checkUserPermission).mockResolvedValue(true)
  })

  describe('processPayPalRefund', () => {
    it('should reject if user lacks refund permission', async () => {
      vi.mocked(checkUserPermission).mockResolvedValue(false)

      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const { processPayPalRefund } = await import('../refundActions')
      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test reason')

      expect(result).toEqual({ error: expect.stringContaining('permission') })
    })

    it('should reject if no PayPal capture ID on booking', async () => {
      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const db = mockSupabaseChain({
        id: 'booking-1',
        deposit_amount: 100,
        paypal_deposit_capture_id: null,
        deposit_paid_date: '2026-04-01',
      })
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const { processPayPalRefund } = await import('../refundActions')
      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test')

      expect(result).toEqual({ error: expect.stringContaining('No PayPal payment') })
    })

    it('should reject if capture is older than 180 days', async () => {
      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const oldDate = new Date()
      oldDate.setDate(oldDate.getDate() - 181)

      const db = mockSupabaseChain({
        id: 'booking-1',
        deposit_amount: 100,
        paypal_deposit_capture_id: 'CAPTURE-1',
        deposit_paid_date: oldDate.toISOString(),
      })
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const { processPayPalRefund } = await import('../refundActions')
      const result = await processPayPalRefund('private_booking', 'booking-1', 10, 'test')

      expect(result).toEqual({ error: expect.stringContaining('180') })
    })
  })

  describe('processManualRefund', () => {
    it('should succeed without calling PayPal API', async () => {
      const mockAuth = { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) } }
      vi.mocked(createClient).mockResolvedValue(mockAuth as any)

      const db = mockSupabaseChain({ id: 'booking-1', deposit_amount: 100, deposit_paid_date: '2026-04-01' })
      db.rpc.mockResolvedValue({ data: 100, error: null })
      vi.mocked(createAdminClient).mockReturnValue(db as any)

      const { processManualRefund } = await import('../refundActions')
      const result = await processManualRefund('private_booking', 'booking-1', 50, 'cash return', 'cash')

      expect(refundPayPalPayment).not.toHaveBeenCalled()
      expect(sendRefundNotification).not.toHaveBeenCalled()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/actions/__tests__/refundActions.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the server actions**

Create `src/app/actions/refundActions.ts`:

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { refundPayPalPayment } from '@/lib/paypal'
import { sendRefundNotification } from '@/lib/refund-notifications'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'

type SourceType = 'private_booking' | 'table_booking' | 'parking'
type RefundMethod = 'paypal' | 'cash' | 'bank_transfer' | 'other'

const SOURCE_MODULE_MAP: Record<SourceType, string> = {
  private_booking: 'private_bookings',
  table_booking: 'table_bookings',
  parking: 'parking',
}

const REVALIDATE_PATHS: Record<SourceType, string> = {
  private_booking: '/private-bookings',
  table_booking: '/table-bookings',
  parking: '/parking',
}

const PAYPAL_REFUND_WINDOW_DAYS = 180

interface SourceBookingData {
  id: string
  captureId: string | null
  captureDate: string | null
  originalAmount: number
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
}

async function getAuthenticatedUser(): Promise<{ userId: string } | { error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  return { userId: user.id }
}

async function checkRefundPermission(sourceType: SourceType, userId: string): Promise<boolean> {
  const module = SOURCE_MODULE_MAP[sourceType]
  return checkUserPermission(module as any, 'refund', userId)
}

async function loadSourceBooking(
  db: ReturnType<typeof createAdminClient>,
  sourceType: SourceType,
  sourceId: string
): Promise<SourceBookingData | null> {
  if (sourceType === 'private_booking') {
    const { data } = await db
      .from('private_bookings')
      .select('id, paypal_deposit_capture_id, deposit_paid_date, deposit_amount, customer_name, email, phone')
      .eq('id', sourceId)
      .maybeSingle()
    if (!data) return null
    return {
      id: data.id,
      captureId: data.paypal_deposit_capture_id,
      captureDate: data.deposit_paid_date,
      originalAmount: Number(data.deposit_amount) || 0,
      customerName: data.customer_name,
      customerEmail: data.email,
      customerPhone: data.phone,
    }
  }

  if (sourceType === 'table_booking') {
    const { data } = await db
      .from('table_bookings')
      .select('id, paypal_deposit_capture_id, deposit_paid_date, deposit_amount, customer_name, email, phone')
      .eq('id', sourceId)
      .maybeSingle()
    if (!data) return null
    return {
      id: data.id,
      captureId: data.paypal_deposit_capture_id,
      captureDate: data.deposit_paid_date,
      originalAmount: Number(data.deposit_amount) || 0,
      customerName: data.customer_name,
      customerEmail: data.email,
      customerPhone: data.phone,
    }
  }

  if (sourceType === 'parking') {
    const { data } = await db
      .from('parking_booking_payments')
      .select('id, transaction_id, paid_at, amount, booking_id, parking_bookings(guest_name, email, phone)')
      .eq('id', sourceId)
      .maybeSingle()
    if (!data) return null
    const booking = (data as any).parking_bookings
    return {
      id: data.id,
      captureId: data.transaction_id,
      captureDate: data.paid_at,
      originalAmount: Number(data.amount) || 0,
      customerName: booking?.guest_name ?? null,
      customerEmail: booking?.email ?? null,
      customerPhone: booking?.phone ?? null,
    }
  }

  return null
}

function isCaptureExpired(captureDate: string | null): boolean {
  if (!captureDate) return false
  const capture = new Date(captureDate)
  const now = new Date()
  const diffDays = (now.getTime() - capture.getTime()) / (1000 * 60 * 60 * 24)
  return diffDays > PAYPAL_REFUND_WINDOW_DAYS
}

async function updateRefundStatus(
  db: ReturnType<typeof createAdminClient>,
  sourceType: SourceType,
  sourceId: string,
  originalAmount: number
): Promise<void> {
  // Sum all completed refunds
  const { data: refunds } = await db
    .from('payment_refunds')
    .select('amount')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('status', 'completed')

  const totalRefunded = (refunds || []).reduce((sum: number, r: any) => sum + Number(r.amount), 0)
  const status = totalRefunded >= originalAmount ? 'refunded' : 'partially_refunded'

  if (sourceType === 'private_booking') {
    await db.from('private_bookings').update({ deposit_refund_status: status }).eq('id', sourceId)
  } else if (sourceType === 'table_booking') {
    await db.from('table_bookings').update({ deposit_refund_status: status }).eq('id', sourceId)
  } else if (sourceType === 'parking') {
    await db.from('parking_booking_payments').update({ refund_status: status }).eq('id', sourceId)
  }
}

export async function processPayPalRefund(
  sourceType: SourceType,
  sourceId: string,
  amount: number,
  reason: string
): Promise<{ success?: boolean; refundId?: string; pending?: boolean; message?: string; error?: string }> {
  // 1. Auth
  const auth = await getAuthenticatedUser()
  if ('error' in auth) return { error: auth.error }
  const { userId } = auth

  // 2. Permission
  const hasPermission = await checkRefundPermission(sourceType, userId)
  if (!hasPermission) return { error: 'Insufficient permission to process refunds' }

  const db = createAdminClient()

  // 3. Load booking
  const booking = await loadSourceBooking(db, sourceType, sourceId)
  if (!booking) return { error: 'Booking not found' }

  // 4. Validate capture exists
  if (!booking.captureId) return { error: 'No PayPal payment to refund. Use manual refund instead.' }

  // 5. Validate capture date
  if (isCaptureExpired(booking.captureDate)) {
    return { error: 'PayPal refund window expired (180 days). Use manual refund instead.' }
  }

  // 6. Check remaining balance with advisory lock
  const { data: remaining, error: rpcError } = await db.rpc('calculate_refundable_balance', {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_original_amount: booking.originalAmount,
  })

  if (rpcError) return { error: `Balance check failed: ${rpcError.message}` }
  if (amount > (remaining ?? 0)) return { error: `Amount exceeds refundable balance (£${(remaining ?? 0).toFixed(2)} remaining)` }

  // 7. Insert pending refund row
  const paypalRequestId = randomUUID()
  const { data: refundRow, error: insertError } = await db
    .from('payment_refunds')
    .insert({
      source_type: sourceType,
      source_id: sourceId,
      paypal_capture_id: booking.captureId,
      paypal_request_id: paypalRequestId,
      refund_method: 'paypal',
      amount,
      original_amount: booking.originalAmount,
      reason,
      status: 'pending',
      initiated_by: userId,
      initiated_by_type: 'staff',
    })
    .select('id')
    .single()

  if (insertError || !refundRow) return { error: `Failed to create refund record: ${insertError?.message}` }

  // 8. Call PayPal
  try {
    const result = await refundPayPalPayment(booking.captureId, amount, paypalRequestId)

    if (result.status === 'COMPLETED') {
      // Update refund row
      await db.from('payment_refunds').update({
        status: 'completed',
        paypal_refund_id: result.refundId,
        paypal_status: 'COMPLETED',
        completed_at: new Date().toISOString(),
      }).eq('id', refundRow.id)

      // Update booking refund status
      await updateRefundStatus(db, sourceType, sourceId, booking.originalAmount)

      // Send notification
      let notificationStatus: string | null = null
      if (booking.customerName) {
        notificationStatus = await sendRefundNotification({
          customerName: booking.customerName,
          email: booking.customerEmail,
          phone: booking.customerPhone,
          amount,
        })
      } else {
        notificationStatus = 'skipped'
      }
      await db.from('payment_refunds').update({ notification_status: notificationStatus }).eq('id', refundRow.id)

      // Audit
      await logAuditEvent({
        user_id: userId,
        operation_type: 'refund',
        resource_type: sourceType,
        resource_id: sourceId,
        operation_status: 'success',
        additional_info: {
          refund_id: refundRow.id,
          paypal_refund_id: result.refundId,
          amount,
          method: 'paypal',
          notification_status: notificationStatus,
        },
      })

      revalidatePath(REVALIDATE_PATHS[sourceType])
      return { success: true, refundId: refundRow.id }
    }

    if (result.status === 'PENDING') {
      await db.from('payment_refunds').update({
        paypal_refund_id: result.refundId,
        paypal_status: 'PENDING',
        paypal_status_details: result.statusDetails || null,
      }).eq('id', refundRow.id)

      await logAuditEvent({
        user_id: userId,
        operation_type: 'refund',
        resource_type: sourceType,
        resource_id: sourceId,
        operation_status: 'success',
        additional_info: {
          refund_id: refundRow.id,
          paypal_refund_id: result.refundId,
          amount,
          method: 'paypal',
          paypal_status: 'PENDING',
          status_details: result.statusDetails,
        },
      })

      revalidatePath(REVALIDATE_PATHS[sourceType])
      return {
        success: true,
        refundId: refundRow.id,
        pending: true,
        message: 'Refund initiated but pending at PayPal — status will update automatically.',
      }
    }

    // FAILED or CANCELLED
    throw new Error(`PayPal returned status: ${result.status}`)
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'

    await db.from('payment_refunds').update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      failure_message: errorMessage,
    }).eq('id', refundRow.id)

    await logAuditEvent({
      user_id: userId,
      operation_type: 'refund',
      resource_type: sourceType,
      resource_id: sourceId,
      operation_status: 'failure',
      error_message: errorMessage,
      additional_info: { refund_id: refundRow.id, amount, method: 'paypal' },
    })

    return { error: `PayPal refund failed: ${errorMessage}. You can try again or use manual refund.` }
  }
}

export async function processManualRefund(
  sourceType: SourceType,
  sourceId: string,
  amount: number,
  reason: string,
  refundMethod: 'cash' | 'bank_transfer' | 'other'
): Promise<{ success?: boolean; refundId?: string; error?: string }> {
  // 1. Auth
  const auth = await getAuthenticatedUser()
  if ('error' in auth) return { error: auth.error }
  const { userId } = auth

  // 2. Permission
  const hasPermission = await checkRefundPermission(sourceType, userId)
  if (!hasPermission) return { error: 'Insufficient permission to process refunds' }

  const db = createAdminClient()

  // 3. Load booking
  const booking = await loadSourceBooking(db, sourceType, sourceId)
  if (!booking) return { error: 'Booking not found' }

  // 4. Check remaining balance with advisory lock
  const { data: remaining, error: rpcError } = await db.rpc('calculate_refundable_balance', {
    p_source_type: sourceType,
    p_source_id: sourceId,
    p_original_amount: booking.originalAmount,
  })

  if (rpcError) return { error: `Balance check failed: ${rpcError.message}` }
  if (amount > (remaining ?? 0)) return { error: `Amount exceeds refundable balance (£${(remaining ?? 0).toFixed(2)} remaining)` }

  // 5. Insert completed refund row
  const { data: refundRow, error: insertError } = await db
    .from('payment_refunds')
    .insert({
      source_type: sourceType,
      source_id: sourceId,
      refund_method: refundMethod,
      amount,
      original_amount: booking.originalAmount,
      reason,
      status: 'completed',
      completed_at: new Date().toISOString(),
      initiated_by: userId,
      initiated_by_type: 'staff',
    })
    .select('id')
    .single()

  if (insertError || !refundRow) return { error: `Failed to create refund record: ${insertError?.message}` }

  // 6. Update booking refund status
  await updateRefundStatus(db, sourceType, sourceId, booking.originalAmount)

  // 7. Audit
  await logAuditEvent({
    user_id: userId,
    operation_type: 'refund',
    resource_type: sourceType,
    resource_id: sourceId,
    operation_status: 'success',
    additional_info: {
      refund_id: refundRow.id,
      amount,
      method: refundMethod,
    },
  })

  revalidatePath(REVALIDATE_PATHS[sourceType])
  return { success: true, refundId: refundRow.id }
}

export async function getRefundHistory(
  sourceType: SourceType,
  sourceId: string
): Promise<{ data?: any[]; error?: string }> {
  // Auth check — view permission on the domain
  const auth = await getAuthenticatedUser()
  if ('error' in auth) return { error: auth.error }

  const module = SOURCE_MODULE_MAP[sourceType]
  const hasPermission = await checkUserPermission(module as any, 'view', auth.userId)
  if (!hasPermission) return { error: 'Insufficient permission' }

  const db = createAdminClient()
  const { data, error } = await db
    .from('payment_refunds')
    .select('*')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .order('created_at', { ascending: false })

  if (error) return { error: error.message }
  return { data: data || [] }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/actions/__tests__/refundActions.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/actions/refundActions.ts src/app/actions/__tests__/refundActions.test.ts
git commit -m "feat(refunds): add processPayPalRefund, processManualRefund, and getRefundHistory server actions"
```

---

### Task 5: Shared UI Components — RefundDialog and RefundHistoryTable

**Files:**
- Create: `src/components/ui-v2/refunds/RefundDialog.tsx`
- Create: `src/components/ui-v2/refunds/RefundHistoryTable.tsx`

- [ ] **Step 1: Create RefundDialog component**

Create `src/components/ui-v2/refunds/RefundDialog.tsx`:

```typescript
'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui-v2/overlay/Dialog'
import { toast } from '@/components/ui-v2/feedback/Toast'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import { processPayPalRefund, processManualRefund } from '@/app/actions/refundActions'

type SourceType = 'private_booking' | 'table_booking' | 'parking'
type RefundMethod = 'paypal' | 'cash' | 'bank_transfer' | 'other'

interface RefundDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceType: SourceType
  sourceId: string
  originalAmount: number
  totalRefunded: number
  totalPending: number
  hasPayPalCapture: boolean
  captureExpired: boolean
}

const METHOD_OPTIONS: { value: RefundMethod; label: string }[] = [
  { value: 'paypal', label: 'PayPal' },
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'other', label: 'Other' },
]

export function RefundDialog({
  open,
  onOpenChange,
  sourceType,
  sourceId,
  originalAmount,
  totalRefunded,
  totalPending,
  hasPayPalCapture,
  captureExpired,
}: RefundDialogProps): React.ReactElement {
  const router = useRouter()
  const remaining = Math.max(0, originalAmount - totalRefunded - totalPending)

  const [method, setMethod] = useState<RefundMethod>(hasPayPalCapture && !captureExpired ? 'paypal' : 'cash')
  const [amount, setAmount] = useState(remaining.toFixed(2))
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const numericAmount = parseFloat(amount) || 0
  const isValid = numericAmount > 0 && numericAmount <= remaining && reason.trim().length > 0

  const handleRefundInFull = useCallback(() => {
    setAmount(remaining.toFixed(2))
  }, [remaining])

  const handleSubmit = useCallback(async () => {
    if (!isValid || submitting) return
    setSubmitting(true)
    setError(null)

    try {
      const result = method === 'paypal'
        ? await processPayPalRefund(sourceType, sourceId, numericAmount, reason.trim())
        : await processManualRefund(sourceType, sourceId, numericAmount, reason.trim(), method)

      if (result.error) {
        setError(result.error)
        return
      }

      if ('pending' in result && result.pending) {
        toast.info(result.message || 'Refund initiated — pending at PayPal.')
      } else {
        toast.success(`Refund of ${formatCurrency(numericAmount)} processed successfully.`)
      }

      onOpenChange(false)
      router.refresh()
    } catch (err) {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }, [isValid, submitting, method, sourceType, sourceId, numericAmount, reason, onOpenChange, router])

  const paypalDisabledReason = !hasPayPalCapture
    ? 'No PayPal payment on this booking'
    : captureExpired
      ? 'PayPal refund window expired (180 days)'
      : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Refund Deposit</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="rounded-md bg-gray-50 p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-gray-500">Original deposit</span>
              <span className="font-medium">{formatCurrency(originalAmount)}</span>
            </div>
            {totalRefunded > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Already refunded</span>
                <span className="text-red-600">-{formatCurrency(totalRefunded)}</span>
              </div>
            )}
            {totalPending > 0 && (
              <div className="flex justify-between">
                <span className="text-gray-500">Pending refunds</span>
                <span className="text-amber-600">-{formatCurrency(totalPending)}</span>
              </div>
            )}
            <div className="flex justify-between border-t pt-1">
              <span className="font-medium">Refundable</span>
              <span className="font-medium">{formatCurrency(remaining)}</span>
            </div>
          </div>

          {/* Method */}
          <fieldset>
            <legend className="text-sm font-medium text-gray-700 mb-2">Refund Method</legend>
            <div className="flex flex-wrap gap-2">
              {METHOD_OPTIONS.map((opt) => {
                const isPaypalDisabled = opt.value === 'paypal' && paypalDisabledReason !== null
                return (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer transition-colors ${
                      method === opt.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    } ${isPaypalDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                    title={isPaypalDisabled ? paypalDisabledReason! : undefined}
                  >
                    <input
                      type="radio"
                      name="refund-method"
                      value={opt.value}
                      checked={method === opt.value}
                      disabled={isPaypalDisabled}
                      onChange={() => setMethod(opt.value)}
                      className="sr-only"
                    />
                    {opt.label}
                  </label>
                )
              })}
            </div>
          </fieldset>

          {/* Amount */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Amount (£)</label>
            <div className="flex gap-2">
              <Input
                type="number"
                step="0.01"
                min="0.01"
                max={remaining}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={submitting}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleRefundInFull}
                disabled={submitting}
              >
                Full refund
              </Button>
            </div>
            {numericAmount > remaining && (
              <p className="text-xs text-red-600 mt-1">Exceeds refundable balance</p>
            )}
          </div>

          {/* Reason */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">Reason (internal only)</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this refund being issued?"
              rows={3}
              disabled={submitting}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            loading={submitting}
          >
            Process Refund
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create RefundHistoryTable component**

Create `src/components/ui-v2/refunds/RefundHistoryTable.tsx`:

```typescript
'use client'

import { useEffect, useState } from 'react'
import { formatDateInLondon } from '@/lib/dateUtils'
import { formatCurrency } from '@/components/ui-v2/utils/format'
import { getRefundHistory } from '@/app/actions/refundActions'
import { Badge } from '@/components/ui-v2/display/Badge'

type SourceType = 'private_booking' | 'table_booking' | 'parking'

interface RefundHistoryTableProps {
  sourceType: SourceType
  sourceId: string
}

const STATUS_VARIANTS: Record<string, string> = {
  completed: 'success',
  pending: 'warning',
  failed: 'danger',
}

const METHOD_LABELS: Record<string, string> = {
  paypal: 'PayPal',
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
}

export function RefundHistoryTable({ sourceType, sourceId }: RefundHistoryTableProps): React.ReactElement | null {
  const [refunds, setRefunds] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const result = await getRefundHistory(sourceType, sourceId)
      if (result.data) setRefunds(result.data)
      setLoading(false)
    }
    load()
  }, [sourceType, sourceId])

  if (loading) return <p className="text-xs text-gray-400">Loading refund history...</p>
  if (refunds.length === 0) return null

  const totalCompleted = refunds.filter(r => r.status === 'completed').reduce((sum: number, r: any) => sum + Number(r.amount), 0)
  const totalPending = refunds.filter(r => r.status === 'pending').reduce((sum: number, r: any) => sum + Number(r.amount), 0)

  return (
    <div className="mt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Refund History</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-gray-500">
              <th className="pb-2 pr-3">Date</th>
              <th className="pb-2 pr-3">Amount</th>
              <th className="pb-2 pr-3">Method</th>
              <th className="pb-2 pr-3">Status</th>
              <th className="pb-2 pr-3">Reason</th>
              <th className="pb-2">Ref</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {refunds.map((r: any) => (
              <tr key={r.id} className={r.status === 'failed' ? 'opacity-50' : ''}>
                <td className="py-2 pr-3 whitespace-nowrap">
                  {formatDateInLondon(r.completed_at || r.created_at, 'dd MMM yyyy HH:mm')}
                </td>
                <td className="py-2 pr-3 font-medium">{formatCurrency(Number(r.amount))}</td>
                <td className="py-2 pr-3">{METHOD_LABELS[r.refund_method] ?? r.refund_method}</td>
                <td className="py-2 pr-3">
                  <Badge variant={STATUS_VARIANTS[r.status] || 'default'}>
                    {r.status === 'completed' ? 'Completed' : r.status === 'pending' ? 'Pending' : 'Failed'}
                  </Badge>
                </td>
                <td className="py-2 pr-3 max-w-[200px] truncate" title={r.reason}>{r.reason}</td>
                <td className="py-2 text-xs text-gray-400">
                  {r.initiated_by_type === 'system' ? 'System' : ''}
                  {r.paypal_refund_id ? ` ${r.paypal_refund_id.slice(0, 12)}...` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex gap-4 text-xs text-gray-500">
        <span>Total refunded: <span className="font-medium text-gray-700">{formatCurrency(totalCompleted)}</span></span>
        {totalPending > 0 && (
          <span>Pending: <span className="font-medium text-amber-600">{formatCurrency(totalPending)}</span></span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors. If there are import issues (e.g. Dialog, Textarea, Badge components), check the actual component paths in `src/components/ui-v2/` and adjust imports accordingly.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui-v2/refunds/RefundDialog.tsx src/components/ui-v2/refunds/RefundHistoryTable.tsx
git commit -m "feat(refunds): add shared RefundDialog and RefundHistoryTable UI components"
```

---

### Task 6: Integrate Refunds into Private Bookings Detail Page

**Files:**
- Modify: `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`

This task adds the refund button, dialog, and history table to the private booking detail page. The pattern established here will be replicated for table bookings and parking.

- [ ] **Step 1: Add refund imports and state**

At the top of `PrivateBookingDetailClient.tsx`, add:

```typescript
import { RefundDialog } from '@/components/ui-v2/refunds/RefundDialog'
import { RefundHistoryTable } from '@/components/ui-v2/refunds/RefundHistoryTable'
```

Find the component's props interface and ensure it includes a `canRefund: boolean` prop (or add it). This should be passed from the server page after checking `checkUserPermission('private_bookings', 'refund')`.

Inside the component, add state:

```typescript
const [refundDialogOpen, setRefundDialogOpen] = useState(false)
```

- [ ] **Step 2: Add refund button in the deposit/payment section**

Find the section that displays deposit information (look for deposit_paid_date, deposit_amount, deposit_payment_method). After the existing deposit status display, add:

```typescript
{canRefund && booking.deposit_paid_date && booking.deposit_refund_status !== 'refunded' && (
  <Button
    variant="secondary"
    size="sm"
    onClick={() => setRefundDialogOpen(true)}
    disabled={booking.deposit_refund_status === 'refunded'}
  >
    Refund Deposit
  </Button>
)}
```

Also add the deposit refund status badge near the existing deposit status:

```typescript
{booking.deposit_refund_status && (
  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
    booking.deposit_refund_status === 'refunded'
      ? 'bg-red-100 text-red-700'
      : 'bg-amber-100 text-amber-700'
  }`}>
    {booking.deposit_refund_status === 'refunded' ? 'Refunded' : 'Partially Refunded'}
  </span>
)}
```

- [ ] **Step 3: Add RefundDialog and RefundHistoryTable**

At the bottom of the component's JSX (before the final closing tag), add:

```typescript
<RefundDialog
  open={refundDialogOpen}
  onOpenChange={setRefundDialogOpen}
  sourceType="private_booking"
  sourceId={booking.id}
  originalAmount={booking.deposit_amount ?? 0}
  totalRefunded={0}  // Will be computed from RefundHistoryTable data — see step 4
  totalPending={0}
  hasPayPalCapture={!!booking.paypal_deposit_capture_id}
  captureExpired={booking.deposit_paid_date ? (Date.now() - new Date(booking.deposit_paid_date).getTime()) > 180 * 24 * 60 * 60 * 1000 : false}
/>

{booking.deposit_paid_date && (
  <RefundHistoryTable sourceType="private_booking" sourceId={booking.id} />
)}
```

Note: The `totalRefunded` and `totalPending` values should ideally come from the same data source as RefundHistoryTable. If this creates a data-fetching issue, lift the refund history fetch into the parent and pass down. The simplest approach: have the server page query refund totals and pass them as props.

- [ ] **Step 4: Update the server page to pass `canRefund` and refund totals**

In `src/app/(authenticated)/private-bookings/[id]/page.tsx`, add:

```typescript
import { checkUserPermission } from '@/app/actions/rbac'

// Inside the server component, after fetching the booking:
const canRefund = await checkUserPermission('private_bookings', 'refund')
```

Pass `canRefund` to `PrivateBookingDetailClient`.

- [ ] **Step 5: Verify in browser**

Run: `npm run dev`
Navigate to a private booking with a paid deposit.
- Verify refund button appears for super_admin
- Verify refund button does NOT appear for non-super_admin
- Click refund, verify dialog opens with correct amounts
- Test a manual refund (cash) end-to-end
- Check refund history table appears after successful refund

- [ ] **Step 6: Commit**

```bash
git add src/app/\(authenticated\)/private-bookings/\[id\]/PrivateBookingDetailClient.tsx src/app/\(authenticated\)/private-bookings/\[id\]/page.tsx
git commit -m "feat(refunds): integrate refund UI into private bookings detail page"
```

---

### Task 7: Integrate Refunds into Table Bookings Detail Page

**Files:**
- Modify: `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx`
- Modify: `src/app/(authenticated)/table-bookings/[id]/page.tsx`

Same pattern as Task 6, adapted for table bookings.

- [ ] **Step 1: Add imports and state to BookingDetailClient.tsx**

```typescript
import { RefundDialog } from '@/components/ui-v2/refunds/RefundDialog'
import { RefundHistoryTable } from '@/components/ui-v2/refunds/RefundHistoryTable'
```

Add `canRefund: boolean` prop and `refundDialogOpen` state.

- [ ] **Step 2: Add refund button in the deposit section**

Find the deposit section (around line 399 — look for `payment_status === 'completed'`). Add the refund button and status badge using the same pattern as Task 6, but with:

```typescript
sourceType="table_booking"
sourceId={booking.id}
originalAmount={booking.deposit_amount ?? 0}
hasPayPalCapture={!!booking.paypal_deposit_capture_id}
```

- [ ] **Step 3: Add RefundDialog and RefundHistoryTable**

Same as Task 6 step 3, with `sourceType="table_booking"`.

- [ ] **Step 4: Update server page to pass `canRefund`**

In `page.tsx`, add `checkUserPermission('table_bookings', 'refund')` and pass to client.

- [ ] **Step 5: Verify in browser**

Navigate to a table booking with a paid deposit. Same verification as Task 6.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(authenticated\)/table-bookings/\[id\]/BookingDetailClient.tsx src/app/\(authenticated\)/table-bookings/\[id\]/page.tsx
git commit -m "feat(refunds): integrate refund UI into table bookings detail page"
```

---

### Task 8: Integrate Refunds into Parking

**Files:**
- Modify: `src/app/(authenticated)/parking/ParkingClient.tsx`

Parking is different — it's a list view with expandable rows, not a separate detail page. The refund button and history go into the expanded booking detail panel.

- [ ] **Step 1: Add imports and state to ParkingClient.tsx**

```typescript
import { RefundDialog } from '@/components/ui-v2/refunds/RefundDialog'
import { RefundHistoryTable } from '@/components/ui-v2/refunds/RefundHistoryTable'
```

Note: Parking uses `parking_booking_payments.id` as the `sourceId`, not the `parking_bookings.id`. Ensure the component has access to the payment row ID and transaction_id.

- [ ] **Step 2: Add refund button in the booking detail expansion**

Find where individual parking booking details are shown (the expanded/detail view). Add the refund button conditionally:

```typescript
{canRefund && payment.status === 'paid' && payment.refund_status !== 'refunded' && (
  <Button variant="secondary" size="sm" onClick={() => openRefundDialog(payment)}>
    Refund
  </Button>
)}
```

- [ ] **Step 3: Add RefundDialog with parking-specific props**

```typescript
<RefundDialog
  open={refundDialogOpen}
  onOpenChange={setRefundDialogOpen}
  sourceType="parking"
  sourceId={selectedPayment?.id ?? ''}
  originalAmount={selectedPayment?.amount ?? 0}
  totalRefunded={0}
  totalPending={0}
  hasPayPalCapture={!!selectedPayment?.transaction_id}
  captureExpired={selectedPayment?.paid_at ? (Date.now() - new Date(selectedPayment.paid_at).getTime()) > 180 * 24 * 60 * 60 * 1000 : false}
/>
```

- [ ] **Step 4: Add RefundHistoryTable**

```typescript
<RefundHistoryTable sourceType="parking" sourceId={selectedPayment?.id ?? ''} />
```

- [ ] **Step 5: Verify in browser**

Navigate to parking, expand a paid booking. Same verification as previous tasks.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(authenticated\)/parking/ParkingClient.tsx
git commit -m "feat(refunds): integrate refund UI into parking"
```

---

### Task 9: Webhook Handling — Private Bookings

**Files:**
- Modify: `src/app/api/webhooks/paypal/private-bookings/route.ts`

- [ ] **Step 1: Create shared refund webhook handler**

Create `src/lib/paypal-refund-webhook.ts` — a shared module used by all three webhook handlers:

```typescript
async function handleRefundEvent(
  supabase: ReturnType<typeof createAdminClient>,
  event: any,
  sourceType: 'private_booking' | 'table_booking' | 'parking'
): Promise<void> {
  const resource = event.resource
  const paypalRefundId = resource.id
  const captureLink = resource.links?.find((link: any) => link.rel === 'up')?.href
  const captureId = captureLink ? captureLink.split('/').pop() : null
  const amount = parseFloat(resource.amount?.value ?? '0')
  const paypalStatus = resource.status // COMPLETED, PENDING, FAILED, CANCELLED
  const statusDetails = resource.status_details?.reason

  // Try match by paypal_refund_id
  const { data: existingRefund } = await supabase
    .from('payment_refunds')
    .select('id, status, source_id, original_amount')
    .eq('paypal_refund_id', paypalRefundId)
    .maybeSingle()

  if (existingRefund) {
    if (existingRefund.status === 'completed') return // Already processed

    if (paypalStatus === 'COMPLETED') {
      await supabase.from('payment_refunds').update({
        status: 'completed',
        paypal_status: 'COMPLETED',
        completed_at: new Date().toISOString(),
      }).eq('id', existingRefund.id)

      // Update booking refund status
      const { data: refunds } = await supabase
        .from('payment_refunds')
        .select('amount')
        .eq('source_type', sourceType)
        .eq('source_id', existingRefund.source_id)
        .eq('status', 'completed')
      const totalRefunded = (refunds || []).reduce((sum: number, r: any) => sum + Number(r.amount), 0)
      const refundStatus = totalRefunded >= Number(existingRefund.original_amount) ? 'refunded' : 'partially_refunded'

      if (sourceType === 'private_booking') {
        await supabase.from('private_bookings').update({ deposit_refund_status: refundStatus }).eq('id', existingRefund.source_id)
      } else if (sourceType === 'table_booking') {
        await supabase.from('table_bookings').update({ deposit_refund_status: refundStatus }).eq('id', existingRefund.source_id)
      } else if (sourceType === 'parking') {
        await supabase.from('parking_booking_payments').update({ refund_status: refundStatus }).eq('id', existingRefund.source_id)
      }
    } else if (paypalStatus === 'FAILED' || paypalStatus === 'CANCELLED') {
      await supabase.from('payment_refunds').update({
        status: 'failed',
        paypal_status: paypalStatus,
        failed_at: new Date().toISOString(),
        failure_message: statusDetails || `PayPal status: ${paypalStatus}`,
      }).eq('id', existingRefund.id)
    } else if (paypalStatus === 'PENDING') {
      await supabase.from('payment_refunds').update({
        paypal_status: 'PENDING',
        paypal_status_details: statusDetails,
      }).eq('id', existingRefund.id)
    }

    return
  }

  // Not found by refund ID — try capture ID for dashboard reconciliation
  if (!captureId) {
    logger.warn('Unmatched refund webhook with no capture ID', { metadata: { paypalRefundId } })
    return
  }

  // Look up source by capture ID
  let sourceId: string | null = null
  let originalAmount = 0

  if (sourceType === 'private_booking') {
    const { data } = await supabase
      .from('private_bookings')
      .select('id, deposit_amount')
      .eq('paypal_deposit_capture_id', captureId)
      .maybeSingle()
    if (data) { sourceId = data.id; originalAmount = Number(data.deposit_amount) }
  } else if (sourceType === 'table_booking') {
    const { data } = await supabase
      .from('table_bookings')
      .select('id, deposit_amount')
      .eq('paypal_deposit_capture_id', captureId)
      .maybeSingle()
    if (data) { sourceId = data.id; originalAmount = Number(data.deposit_amount) }
  } else if (sourceType === 'parking') {
    const { data } = await supabase
      .from('parking_booking_payments')
      .select('id, amount')
      .eq('transaction_id', captureId)
      .maybeSingle()
    if (data) { sourceId = data.id; originalAmount = Number(data.amount) }
  }

  if (!sourceId) {
    logger.warn('Unmatched refund webhook — no booking found for capture', { metadata: { paypalRefundId, captureId } })
    return
  }

  // Create system-originated refund row
  const status = paypalStatus === 'COMPLETED' ? 'completed' : paypalStatus === 'PENDING' ? 'pending' : 'failed'
  await supabase.from('payment_refunds').insert({
    source_type: sourceType,
    source_id: sourceId,
    paypal_capture_id: captureId,
    paypal_refund_id: paypalRefundId,
    paypal_status: paypalStatus,
    paypal_status_details: statusDetails,
    refund_method: 'paypal',
    amount,
    original_amount: originalAmount,
    reason: 'Refund initiated via PayPal dashboard',
    status,
    initiated_by: null,
    initiated_by_type: 'system',
    completed_at: status === 'completed' ? new Date().toISOString() : null,
    failed_at: status === 'failed' ? new Date().toISOString() : null,
  })

  // Update booking refund status if completed
  if (status === 'completed') {
    const { data: allRefunds } = await supabase
      .from('payment_refunds')
      .select('amount')
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .eq('status', 'completed')
    const totalRefunded = (allRefunds || []).reduce((sum: number, r: any) => sum + Number(r.amount), 0)
    const refundStatus = totalRefunded >= originalAmount ? 'refunded' : 'partially_refunded'

    if (sourceType === 'private_booking') {
      await supabase.from('private_bookings').update({ deposit_refund_status: refundStatus }).eq('id', sourceId)
    } else if (sourceType === 'table_booking') {
      await supabase.from('table_bookings').update({ deposit_refund_status: refundStatus }).eq('id', sourceId)
    } else if (sourceType === 'parking') {
      await supabase.from('parking_booking_payments').update({ refund_status: refundStatus }).eq('id', sourceId)
    }
  }

  await supabase.from('audit_logs').insert({
    action: 'paypal_dashboard_refund_reconciled',
    entity_type: sourceType,
    entity_id: sourceId,
    metadata: { paypal_refund_id: paypalRefundId, amount, capture_id: captureId },
  })
}
```

- [ ] **Step 2: Update the event routing in private-bookings webhook**

The key fix: refund events don't have `custom_id` starting with `pb-deposit-`. Change the routing logic (around line 152) so that refund events bypass the `custom_id` check:

```typescript
const REFUND_EVENT_TYPES = [
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.REFUND.PENDING',
  'PAYMENT.REFUND.FAILED',
]

const isRefundEvent = REFUND_EVENT_TYPES.includes(eventType)

// Check if this event is for a private booking deposit
const customId = event?.resource?.custom_id ?? ''
if (!isRefundEvent && (typeof customId !== 'string' || !customId.startsWith(DEPOSIT_CUSTOM_ID_PREFIX))) {
  // Not a private booking event — acknowledge without processing
  await logPayPalWebhook(supabase, { status: 'ignored', headers, body, eventId, eventType })
  return NextResponse.json({ received: true, ignored: true })
}
```

Then update the switch statement:

```typescript
switch (eventType) {
  case 'PAYMENT.CAPTURE.COMPLETED':
    await handleDepositCaptureCompleted(supabase, event)
    break
  case 'PAYMENT.CAPTURE.DENIED':
    await handleDepositCaptureDenied(supabase, event)
    break
  case 'PAYMENT.CAPTURE.REFUNDED':
  case 'PAYMENT.REFUND.PENDING':
  case 'PAYMENT.REFUND.FAILED':
    await handleRefundEvent(supabase, event, 'private_booking')
    break
  default:
    logger.info('Unhandled PayPal private-bookings webhook event type', {
      metadata: { eventId, eventType }
    })
}
```

- [ ] **Step 3: Run build to check**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/paypal-refund-webhook.ts src/app/api/webhooks/paypal/private-bookings/route.ts
git commit -m "feat(refunds): add shared refund webhook handler, integrate into private bookings"
```

---

### Task 10: Webhook Handling — Table Bookings

**Files:**
- Modify: `src/app/api/webhooks/paypal/table-bookings/route.ts`

- [ ] **Step 1: Update event type filtering**

Change line 224 from:

```typescript
if (eventType !== 'PAYMENT.CAPTURE.COMPLETED') {
```

To:

```typescript
const HANDLED_EVENT_TYPES = [
  'PAYMENT.CAPTURE.COMPLETED',
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.REFUND.PENDING',
  'PAYMENT.REFUND.FAILED',
]

if (!HANDLED_EVENT_TYPES.includes(eventType)) {
```

- [ ] **Step 2: Add refund handling to the processing section**

After the existing `PAYMENT.CAPTURE.COMPLETED` handler, add:

```typescript
case 'PAYMENT.CAPTURE.REFUNDED':
case 'PAYMENT.REFUND.PENDING':
case 'PAYMENT.REFUND.FAILED':
  await handleRefundEvent(supabase, event, 'table_booking')
  break
```

Import `handleRefundEvent` from `src/lib/paypal-refund-webhook.ts` (created in Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/paypal/table-bookings/route.ts src/lib/paypal-refund-webhook.ts
git commit -m "feat(refunds): add refund webhook handling to table bookings, extract shared handler"
```

---

### Task 11: Webhook Handling — Parking (Fix Existing + Integrate)

**Files:**
- Modify: `src/app/api/webhooks/paypal/parking/route.ts`

The parking webhook already handles `PAYMENT.CAPTURE.REFUNDED` but it currently cancels the booking (`status: 'cancelled'`). We need to:
1. Remove the booking status change
2. Integrate with the `payment_refunds` table
3. Add `PAYMENT.REFUND.PENDING` and `PAYMENT.REFUND.FAILED`

- [ ] **Step 1: Replace `handleRefundCompleted` with shared handler**

Remove the existing `handleRefundCompleted` function (lines ~535-615). Replace the switch case:

```typescript
case 'PAYMENT.CAPTURE.REFUNDED':
case 'PAYMENT.REFUND.PENDING':
case 'PAYMENT.REFUND.FAILED':
  await handleRefundEvent(supabase, event, 'parking')
  break
```

Import `handleRefundEvent` from `src/lib/paypal-refund-webhook.ts`.

- [ ] **Step 2: Add the new event types to the switch**

Ensure `PAYMENT.REFUND.PENDING` and `PAYMENT.REFUND.FAILED` are in the switch alongside the existing `PAYMENT.CAPTURE.REFUNDED`.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/paypal/parking/route.ts
git commit -m "fix(refunds): replace parking refund handler — use shared handler, stop cancelling bookings"
```

---

### Task 12: Type Check, Lint, Build, and Final Verification

**Files:** None — verification only.

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: Zero errors, zero warnings. Fix any issues.

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean compilation.

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass, including the new ones from Tasks 2, 3, and 4.

- [ ] **Step 4: Run build**

Run: `npm run build`
Expected: Successful production build.

- [ ] **Step 5: Manual end-to-end verification**

Start dev server: `npm run dev`

Test matrix:

| Domain | PayPal Refund | Manual (Cash) | Partial + Full | Refund History |
|--------|--------------|---------------|----------------|----------------|
| Private booking | Test | Test | Test | Verify |
| Table booking | Test | Test | Test | Verify |
| Parking | Test | Test | Test | Verify |

For each domain:
1. Navigate to a booking with a paid deposit
2. Verify refund button visible as super_admin
3. Open dialog — verify amounts are correct
4. Process a partial manual (cash) refund — verify status badge shows "Partially Refunded"
5. Process another refund for the remaining balance — verify "Refunded" status
6. Verify refund history table shows both entries
7. Verify refund button is disabled after full refund
8. Check audit_logs table for refund entries

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(refunds): address verification findings"
```
