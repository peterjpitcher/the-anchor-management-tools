import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import { getTablePaymentPreviewByRawToken } from '@/lib/table-bookings/bookings'
import { tablePaymentBlockedReasonMessage } from '@/lib/table-bookings/table-payment-blocked-reason'
import { GuestPageShell } from '@/components/features/shared/GuestPageShell'
import { createSimplePayPalOrder, capturePayPalPayment } from '@/lib/paypal'
import { logAuditEvent } from '@/app/actions/audit'
import { TablePaymentClient } from './TablePaymentClient'

type TablePaymentPageProps = {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export const dynamic = 'force-dynamic'

function getSingleValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

export default async function TablePaymentPage({ params, searchParams }: TablePaymentPageProps) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const state = getSingleValue(resolvedSearchParams.state)
  const reason = getSingleValue(resolvedSearchParams.reason)
  const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682707'

  if (state === 'blocked') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Payment link unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'we could not open your payment link.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">{tablePaymentBlockedReasonMessage(reason)}</p>
          <p className="mt-3 text-sm text-slate-700">Please call {contactPhone} for help.</p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="https://www.the-anchor.pub/book-table">
              Back to book a table
            </Link>
          </div>
        </div>
      </GuestPageShell>
    )
  }

  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_table_payment_view',
    maxAttempts: 60,
  })

  if (!throttle.allowed) {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Payment link unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'we could not open your payment link.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">{tablePaymentBlockedReasonMessage('rate_limited')}</p>
          <p className="mt-3 text-sm text-slate-700">Please call {contactPhone} for help.</p>
        </div>
      </GuestPageShell>
    )
  }

  const supabase = createAdminClient()
  const preview = await getTablePaymentPreviewByRawToken(supabase, token)

  if (preview.state !== 'ready') {
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Payment link unavailable</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(null, 'we could not open your payment link.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">{tablePaymentBlockedReasonMessage(preview.reason)}</p>
          <p className="mt-3 text-sm text-slate-700">Please call {contactPhone} for help.</p>
        </div>
      </GuestPageShell>
    )
  }

  // preview.state === 'ready' from here — all fields are available
  const { data: booking } = await supabase
    .from('table_bookings')
    .select('payment_status, paypal_deposit_order_id')
    .eq('id', preview.tableBookingId)
    .single()

  // Already paid — show confirmation
  if (booking?.payment_status === 'completed') {
    const guestFirstNameForSuccess = await getCustomerFirstNameById(supabase, preview.customerId)
    return (
      <GuestPageShell>
        <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Deposit received</h1>
          <p className="mt-2 text-sm text-slate-700">
            {formatGuestGreeting(guestFirstNameForSuccess, 'your deposit payment has been received.')}
          </p>
          <p className="mt-3 text-sm text-slate-700">
            Thanks. We are confirming your booking now. You will receive a text confirmation shortly.
          </p>
          <p className="mt-3 text-sm text-slate-700">
            If you do not receive confirmation, call {contactPhone}.
          </p>
          <div className="mt-6">
            <Link className="text-sm font-medium text-slate-900 underline underline-offset-4" href="https://www.the-anchor.pub/book-table">
              Back to The Anchor
            </Link>
          </div>
        </div>
      </GuestPageShell>
    )
  }

  // Create or reuse PayPal order
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.the-anchor.pub'
  let paypalOrderId: string

  if (booking?.paypal_deposit_order_id) {
    paypalOrderId = booking.paypal_deposit_order_id as string
  } else {
    let paypalOrder: { orderId: string }
    try {
      paypalOrder = await createSimplePayPalOrder({
        customId: preview.tableBookingId,
        reference: `tb-deposit-${preview.tableBookingId}`,
        description: `Table booking deposit – ${preview.partySize} guests`,
        amount: preview.totalAmount,
        currency: preview.currency,
        returnUrl: `${appBaseUrl}/g/${token}/table-payment`,
        cancelUrl: `${appBaseUrl}/g/${token}/table-payment?state=cancelled`,
        requestId: `tb-deposit-${preview.tableBookingId}`,
      })
    } catch {
      return (
        <GuestPageShell>
          <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
            <h1 className="text-2xl font-semibold text-slate-900">Payment unavailable</h1>
            <p className="mt-2 text-sm text-slate-700">
              {formatGuestGreeting(null, 'we could not set up your payment right now.')}
            </p>
            <p className="mt-3 text-sm text-slate-700">Please call {contactPhone} for help.</p>
          </div>
        </GuestPageShell>
      )
    }

    paypalOrderId = paypalOrder.orderId

    await supabase
      .from('table_bookings')
      .update({
        paypal_deposit_order_id: paypalOrderId,
        deposit_amount: preview.totalAmount,
      })
      .eq('id', preview.tableBookingId)

    void logAuditEvent({
      operation_type: 'payment.order_created',
      resource_type: 'table_booking',
      resource_id: preview.tableBookingId,
      operation_status: 'success',
      additional_info: {
        orderId: paypalOrderId,
        amount: preview.totalAmount,
        currency: preview.currency,
        bookingId: preview.tableBookingId,
        partySize: preview.partySize,
      },
    })
  }

  // Capture server action — 'use server' inside the function body
  const bookingIdForCapture = preview.tableBookingId
  async function captureDeposit(captureOrderId: string): Promise<{ success: boolean; error?: string }> {
    'use server'
    const db = createAdminClient()
    try {
      const capture = await capturePayPalPayment(captureOrderId)
      await db
        .from('table_bookings')
        .update({
          payment_status: 'completed',
          status: 'confirmed',
          payment_method: 'paypal',
          paypal_deposit_capture_id: capture.transactionId,
        })
        .eq('id', bookingIdForCapture)

      void logAuditEvent({
        operation_type: 'payment.captured',
        resource_type: 'table_booking',
        resource_id: bookingIdForCapture,
        operation_status: 'success',
        additional_info: {
          transactionId: capture.transactionId,
          amount: capture.amount,
          bookingId: bookingIdForCapture,
        },
      })

      return { success: true }
    } catch (err) {
      void logAuditEvent({
        operation_type: 'payment.capture_failed',
        resource_type: 'table_booking',
        resource_id: bookingIdForCapture,
        operation_status: 'failure',
        additional_info: {
          orderId: captureOrderId,
          error: err instanceof Error ? err.message : String(err),
          bookingId: bookingIdForCapture,
        },
      })
      return { success: false, error: 'Payment capture failed. Please call us to confirm.' }
    }
  }

  const guestFirstName = await getCustomerFirstNameById(supabase, preview.customerId)
  const paypalClientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? process.env.PAYPAL_CLIENT_ID ?? ''
  const paypalEnvironment = process.env.PAYPAL_ENVIRONMENT ?? 'live'

  return (
    <GuestPageShell>
      <div className="mx-auto w-full max-w-xl rounded-xl border border-white/15 bg-white px-6 py-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Complete your deposit payment</h1>
        <p className="mt-2 text-sm text-slate-700">
          {formatGuestGreeting(guestFirstName, 'your booking and deposit details are below.')}
        </p>
        <div className="mt-4">
          <TablePaymentClient
            orderId={paypalOrderId}
            bookingReference={preview.bookingReference}
            depositAmount={preview.totalAmount}
            currency={preview.currency}
            partySize={preview.partySize}
            holdExpiresAt={preview.holdExpiresAt}
            showCancelledMessage={state === 'cancelled'}
            paypalClientId={paypalClientId}
            paypalEnvironment={paypalEnvironment}
            captureAction={captureDeposit}
          />
        </div>
        <p className="mt-4 text-sm text-slate-700">
          Need help? Call {contactPhone}.
        </p>
      </div>
    </GuestPageShell>
  )
}
