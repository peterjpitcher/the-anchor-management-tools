'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js'
// Imported file by file rather than through '@/components/features/guest': the
// barrel re-exports GuestShell, which loads the guest webfonts, and a client
// module has no need of them.
import { GuestAlert } from '@/components/features/guest/GuestAlert'
import { GuestButton } from '@/components/features/guest/GuestButton'
import { GuestLink } from '@/components/features/guest/GuestLink'
import { TrustLine } from '@/components/features/guest/TrustLine'
import { GUEST_NOTE_CLASS } from '@/components/features/guest/styles'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { EVENT_PAYMENT_CAPTURE_FALLBACK, EVENT_PAYMENT_START_FALLBACK } from '@/lib/events/event-payment-reasons'

type PaymentState = 'idle' | 'creating' | 'paying' | 'success' | 'manual_review' | 'error'

/*
 * Where a failure happened decides what the guest is told (BK-029, customer bookings review of
 * 24 October 2026). Before PayPal approves the payment nothing has been charged, so "Try again"
 * is right. After approval PayPal may already have the money, so the page offers the phone
 * number instead of a second payment. It used to show the routes' bare reason codes
 * ("hold_expired") and "Try again" after any failure.
 */
type FailureStep = 'start' | 'capture'

/** The sentence a route sent for the guest, or the cautious one for the step. */
function guestSentence(body: unknown, step: FailureStep): string {
  const message = body && typeof body === 'object' ? (body as { message?: unknown }).message : null
  if (typeof message === 'string' && message.trim()) return message
  return step === 'capture' ? EVENT_PAYMENT_CAPTURE_FALLBACK : EVENT_PAYMENT_START_FALLBACK
}

type EventPayPalPaymentClientProps = {
  token: string
  paypalClientId: string
  paypalEnvironment: string
  currency: string
  fallbackUrl: string
}

export function EventPayPalPaymentClient({
  token,
  paypalClientId,
  paypalEnvironment,
  currency,
  fallbackUrl,
}: EventPayPalPaymentClientProps) {
  const [paymentState, setPaymentState] = useState<PaymentState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [failureStep, setFailureStep] = useState<FailureStep>('start')
  const [orderId, setOrderId] = useState<string | null>(null)

  // PayPal's own onError also fires when createOrder throws; it must not replace the sentence
  // the route sent with its generic one.
  const failed = useRef(false)

  function fail(step: FailureStep, message: string) {
    failed.current = true
    setFailureStep(step)
    setErrorMessage(message)
    setPaymentState('error')
  }

  if (!paypalClientId) {
    return (
      <GuestAlert tone="notice" role="alert">
        Online payment is temporarily unavailable. Please call us, or try the payment link again shortly.
      </GuestAlert>
    )
  }

  if (paymentState === 'success') {
    return (
      <GuestAlert tone="success" role="status">
        Payment received. Your booking is confirmed and we will send confirmation shortly.
      </GuestAlert>
    )
  }

  if (paymentState === 'manual_review') {
    return (
      <GuestAlert tone="notice" role="status">
        Payment received. Staff need to check your booking before confirming. We will contact you shortly.
      </GuestAlert>
    )
  }

  return (
    // The pointer-events guard stays: it stops a second tap reaching PayPal
    // while an order is being created or captured.
    <div
      className={cn(
        'flex flex-col gap-3',
        (paymentState === 'creating' || paymentState === 'paying') && 'pointer-events-none'
      )}
    >
      {paymentState === 'error' && (
        <GuestAlert
          tone="problem"
          role="alert"
          action={
            failureStep === 'capture' ? (
              <GuestLink href={GUEST_CONTACT.telHref}>Call {GUEST_CONTACT.phoneDisplay}</GuestLink>
            ) : (
              <GuestButton
                variant="outline"
                size="sm"
                onClick={() => {
                  failed.current = false
                  setErrorMessage(null)
                  setPaymentState('idle')
                }}
              >
                Try again
              </GuestButton>
            )
          }
        >
          {errorMessage || (failureStep === 'capture' ? EVENT_PAYMENT_CAPTURE_FALLBACK : EVENT_PAYMENT_START_FALLBACK)}
        </GuestAlert>
      )}

      <PayPalScriptProvider
        options={{
          clientId: paypalClientId,
          currency,
          intent: 'capture',
          environment: paypalEnvironment === 'sandbox' ? 'sandbox' : 'production',
        }}
      >
        {/*
          PayPal owns this button's look. The handoff is explicit that the SDK
          output is not restyled: only the chrome around it is ours.
        */}
        <PayPalButtons
          style={{ layout: 'vertical', shape: 'rect' }}
          disabled={paymentState === 'creating' || paymentState === 'paying'}
          createOrder={async () => {
            failed.current = false
            setPaymentState('creating')
            setErrorMessage(null)
            const response = await fetch(`/g/${encodeURIComponent(token)}/event-payment/paypal/create-order`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
            })
            const data = await response.json().catch(() => null)
            if (!response.ok || !data?.orderId) {
              const message = guestSentence(data, 'start')
              fail('start', message)
              throw new Error(message)
            }
            setOrderId(data.orderId)
            setPaymentState('paying')
            return data.orderId
          }}
          onApprove={async (data) => {
            const approvedOrderId = data.orderID || orderId
            if (!approvedOrderId) {
              fail('capture', EVENT_PAYMENT_CAPTURE_FALLBACK)
              return
            }

            let response: Response
            try {
              response = await fetch(`/g/${encodeURIComponent(token)}/event-payment/paypal/capture-order`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify({ orderId: approvedOrderId }),
              })
            } catch {
              // No answer at all: the payment may still have gone through.
              fail('capture', EVENT_PAYMENT_CAPTURE_FALLBACK)
              return
            }
            const result = await response.json().catch(() => null)

            if (response.ok && result?.success === true) {
              setPaymentState('success')
              return
            }

            if (response.status === 202 || result?.state === 'manual_review') {
              setPaymentState('manual_review')
              return
            }

            fail('capture', guestSentence(result, 'capture'))
          }}
          onCancel={() => {
            setPaymentState('idle')
          }}
          onError={() => {
            if (failed.current) return
            fail('start', 'PayPal encountered an error. Please try again.')
          }}
        />
      </PayPalScriptProvider>

      {(paymentState === 'creating' || paymentState === 'paying') && (
        <p className={cn('text-center', GUEST_NOTE_CLASS)}>Processing payment, please wait.</p>
      )}

      <TrustLine />

      <p className={cn('text-center', GUEST_NOTE_CLASS)}>
        If PayPal does not load, <GuestLink href={fallbackUrl}>refresh this payment page</GuestLink>.
      </p>
    </div>
  )
}
