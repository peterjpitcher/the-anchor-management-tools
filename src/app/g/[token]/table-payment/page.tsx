import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import { getTablePaymentPreviewByRawToken } from '@/lib/table-bookings/bookings'
import { tablePaymentBlockedReasonMessage } from '@/lib/table-bookings/table-payment-blocked-reason'
import { GuestBlockedState, GuestShell } from '@/components/features/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { createInlinePayPalOrder, getPayPalOrder } from '@/lib/paypal'
import { logAuditEvent } from '@/app/actions/audit'
import { TablePaymentClient } from './TablePaymentClient'
import { TablePaymentSuccessPanel } from './TablePaymentSuccessPanel'
import { captureTableDeposit, type CaptureTableDepositResult } from '@/lib/table-bookings/capture-deposit'
import {
  extractPayPalOrderAmountGbp,
  payPalAmountsMatch,
  payPalDepositCaptureBlockMessage,
} from '@/lib/table-bookings/paypal-deposit'

type TablePaymentPageProps = {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

// Static and non-personal on purpose: no token, customer name or booking reference may reach
// a browser title or history entry. These routes are noindex via the X-Robots-Tag header.
export const metadata = { title: 'Pay your deposit - The Anchor' }

export const dynamic = 'force-dynamic'

function getSingleValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]
  }
  return value
}

/** Where both the blocked and success screens send a guest who wants to start again. */
const BOOK_TABLE_URL = `${GUEST_CONTACT.website}/book-table`

/**
 * Every unavailable, expired and rate-limited screen on this route.
 *
 * This is the shared blocked pattern the other guest routes reuse: one
 * `GuestBlockedState`, a route-specific kicker, heading and lead, the mapped
 * reason string verbatim as the alert title, a `tel:` primary and a way back.
 * Only the four text values change per route.
 */
function BlockedScreen({ reason }: { reason: string | undefined }): React.JSX.Element {
  return (
    <GuestShell>
      <GuestBlockedState
        kicker="Table booking"
        heading="Payment link unavailable"
        lead={formatGuestGreeting(null, 'we could not open your payment link.')}
        reason={tablePaymentBlockedReasonMessage(reason)}
        primaryAction={{
          label: `Call ${GUEST_CONTACT.phoneDisplay}`,
          href: GUEST_CONTACT.telHref,
        }}
        secondaryAction={{ label: 'Back to book a table', href: BOOK_TABLE_URL }}
      />
    </GuestShell>
  )
}

/**
 * PayPal order setup failed. Distinct from `BlockedScreen`: the link itself is
 * fine, so there is no blocked reason to name, and the guest is asked to call.
 */
function PaymentSetupFailedScreen({ lead }: { lead: string }): React.JSX.Element {
  return (
    <GuestShell>
      <GuestBlockedState
        kicker="Table booking"
        heading="Payment unavailable"
        lead={lead}
        primaryAction={{
          label: `Call ${GUEST_CONTACT.phoneDisplay}`,
          href: GUEST_CONTACT.telHref,
        }}
      />
    </GuestShell>
  )
}

/** What the guest reads when the deposit capture stops, for each reason it can stop. */
function guestCaptureMessage(result: Exclude<CaptureTableDepositResult, { ok: true }>): string {
  switch (result.code) {
    case 'BOOKING_NOT_FOUND':
      return 'Booking could not be verified. Please contact us.'
    case 'ORDER_MISMATCH':
      return 'Payment verification failed. Please contact us.'
    case 'NOT_PAYABLE':
      return payPalDepositCaptureBlockMessage(result.blockReason)
    case 'PAYPAL_ORDER_LOOKUP_FAILED':
      return 'We could not reach PayPal to check your payment. Please try again.'
    case 'AMOUNT_MISMATCH':
      return 'Payment amount no longer matches this booking. Please refresh the page.'
    case 'CAPTURE_PENDING':
      return 'PayPal is still processing this payment. Please contact us; do not retry.'
    case 'CAPTURE_DECLINED':
      return 'PayPal did not take this payment. Please contact us.'
    case 'CAPTURE_BOOKING_MISMATCH':
      return 'Payment verification failed. Please contact us; do not retry.'
    case 'CAPTURED_AMOUNT_UNVERIFIED':
      return 'Payment captured but amount could not be verified. Please contact us; do not retry.'
    case 'CAPTURED_AMOUNT_MISMATCH':
      return 'Payment captured but amount did not match the booking. Please contact us; do not retry.'
    case 'CAPTURED_BOOKING_UPDATE_FAILED':
      return 'Payment captured but booking update failed. Our team has been notified.'
    case 'CAPTURE_FAILED':
    default:
      return 'Payment capture failed. Please call us to confirm.'
  }
}

export default async function TablePaymentPage({ params, searchParams }: TablePaymentPageProps) {
  const { token } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const state = getSingleValue(resolvedSearchParams.state)
  const reason = getSingleValue(resolvedSearchParams.reason)

  if (state === 'blocked') {
    return <BlockedScreen reason={reason} />
  }

  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_table_payment_view',
    maxAttempts: 60,
  })

  if (!throttle.allowed) {
    return <BlockedScreen reason="rate_limited" />
  }

  const supabase = createAdminClient()
  const preview = await getTablePaymentPreviewByRawToken(supabase, token)

  if (preview.state !== 'ready') {
    return <BlockedScreen reason={preview.reason} />
  }

  // preview.state === 'ready' from here: all fields are available
  const guestFirstName = await getCustomerFirstNameById(supabase, preview.customerId)
  const { data: booking } = await supabase
    .from('table_bookings')
    .select('payment_status, paypal_deposit_order_id, is_outside_seating')
    .eq('id', preview.tableBookingId)
    .single()

  const isOutsideSeating = Boolean(booking?.is_outside_seating)

  // Computed once and used twice: rendered directly when the deposit is already
  // settled, and handed to the client as its `success` prop so a capture that
  // completes in the browser lands on the identical screen (spec F11).
  const successContent = <TablePaymentSuccessPanel guestFirstName={guestFirstName} />

  if (booking?.payment_status === 'completed') {
    return <GuestShell>{successContent}</GuestShell>
  }

  // Create or reuse a PayPal order (only reuse if still valid on PayPal's side).
  // No return or cancel URL: the guest pays in the PayPal popup and never leaves
  // this page, so there is no redirect to come back from.
  let paypalOrderId = ''
  let needsNewOrder = true

  if (booking?.paypal_deposit_order_id) {
    try {
      const existingOrder = await getPayPalOrder(booking.paypal_deposit_order_id as string)
      const existingAmount = extractPayPalOrderAmountGbp(existingOrder)
      if (
        (existingOrder.status === 'CREATED' || existingOrder.status === 'APPROVED') &&
        existingAmount !== null &&
        payPalAmountsMatch(existingAmount, preview.totalAmount)
      ) {
        paypalOrderId = booking.paypal_deposit_order_id as string
        needsNewOrder = false
      }
    } catch {
      // Order expired or invalid on PayPal's side, so create a fresh one
    }
  }

  if (needsNewOrder) {
    let paypalOrder: { orderId: string }
    try {
      // Inline, NOT createSimplePayPalOrder. This order is handed to
      // <PayPalButtons>, which opens PayPal in a popup, and
      // createSimplePayPalOrder attaches payment_source redirect URLs that make
      // that popup close itself the moment it opens (see the note on
      // createInlinePayPalOrder in src/lib/paypal.ts). onApprove would then
      // never fire and the deposit would never be captured. The external API
      // route has always used the inline builder for exactly this reason.
      paypalOrder = await createInlinePayPalOrder({
        customId: preview.tableBookingId,
        reference: `tb-deposit-${preview.tableBookingId}`,
        description: `Table booking deposit – ${preview.partySize} guests`,
        amount: preview.totalAmount,
        currency: preview.currency,
        requestId: `tb-deposit-${preview.tableBookingId}`,
      })
    } catch {
      return (
        <PaymentSetupFailedScreen
          lead={formatGuestGreeting(null, 'we could not set up your payment right now.')}
        />
      )
    }

    paypalOrderId = paypalOrder.orderId

    // Persist the order ID only. Deliberately not writing deposit_amount:
    // the canonical reader (preview.totalAmount derives from
    // getCanonicalDeposit) is the source of truth, and capture-time is when
    // we lock the actually-charged amount via deposit_amount_locked.
    // Spec §7.3, §7.4, §8.3.
    const { error: persistOrderError } = await supabase
      .from('table_bookings')
      .update({
        paypal_deposit_order_id: paypalOrderId,
      })
      .eq('id', preview.tableBookingId)

    if (persistOrderError) {
      void logAuditEvent({
        operation_type: 'payment.order_persist_failed',
        resource_type: 'table_booking',
        resource_id: preview.tableBookingId,
        operation_status: 'failure',
        additional_info: {
          orderId: paypalOrderId,
          amount: preview.totalAmount,
          dbError: persistOrderError.message,
          action_needed: 'PayPal order created but order ID was not persisted',
        },
      })
      return (
        <PaymentSetupFailedScreen
          lead={formatGuestGreeting(null, 'we could not save your payment setup right now.')}
        />
      )
    }

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

  // Capture server action, 'use server' inside the function body. The steps are the shared table
  // deposit capture (captureTableDeposit, BK-129); only the guest's wording is decided here.
  const bookingIdForCapture = preview.tableBookingId
  const expectedCurrencyForCapture = preview.currency
  async function captureDeposit(captureOrderId: string): Promise<{ success: boolean; error?: string }> {
    'use server'
    const result = await captureTableDeposit(createAdminClient(), {
      bookingId: bookingIdForCapture,
      orderId: captureOrderId,
      source: 'guest payment link',
      createdVia: 'guest_table_payment',
      currency: expectedCurrencyForCapture,
    })
    if (result.ok) return { success: true }
    return { success: false, error: guestCaptureMessage(result) }
  }

  const paypalClientId = process.env.PAYPAL_CLIENT_ID ?? ''
  const paypalEnvironment = process.env.PAYPAL_ENVIRONMENT ?? 'live'

  return (
    <GuestShell>
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
        isOutsideSeating={isOutsideSeating}
        greeting={formatGuestGreeting(guestFirstName, 'your booking and deposit details are below.')}
        success={successContent}
      />
    </GuestShell>
  )
}
