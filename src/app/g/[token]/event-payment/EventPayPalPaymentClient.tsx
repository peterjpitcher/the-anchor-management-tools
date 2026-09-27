'use client'

import { useState } from 'react'
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

type PaymentState = 'idle' | 'creating' | 'paying' | 'success' | 'manual_review' | 'error'

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
  const [orderId, setOrderId] = useState<string | null>(null)

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
            <GuestButton
              variant="outline"
              size="sm"
              onClick={() => {
                setErrorMessage(null)
                setPaymentState('idle')
              }}
            >
              Try again
            </GuestButton>
          }
        >
          {errorMessage || 'Payment failed. Please try again.'}
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
            setPaymentState('creating')
            setErrorMessage(null)
            const response = await fetch(`/g/${encodeURIComponent(token)}/event-payment/paypal/create-order`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
            })
            const data = await response.json().catch(() => null)
            if (!response.ok || !data?.orderId) {
              setPaymentState('error')
              setErrorMessage(data?.error || 'Could not start PayPal payment.')
              throw new Error(data?.error || 'Could not start PayPal payment.')
            }
            setOrderId(data.orderId)
            setPaymentState('paying')
            return data.orderId
          }}
          onApprove={async (data) => {
            const approvedOrderId = data.orderID || orderId
            if (!approvedOrderId) {
              setPaymentState('error')
              setErrorMessage('PayPal did not return an order ID.')
              return
            }

            const response = await fetch(`/g/${encodeURIComponent(token)}/event-payment/paypal/capture-order`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              cache: 'no-store',
              body: JSON.stringify({ orderId: approvedOrderId }),
            })
            const result = await response.json().catch(() => null)

            if (response.ok && result?.success === true) {
              setPaymentState('success')
              return
            }

            if (response.status === 202 || result?.state === 'manual_review') {
              setPaymentState('manual_review')
              return
            }

            setPaymentState('error')
            setErrorMessage(result?.error || 'Payment could not be confirmed. Please call us.')
          }}
          onCancel={() => {
            setPaymentState('idle')
          }}
          onError={() => {
            setErrorMessage('PayPal encountered an error. Please try again.')
            setPaymentState('error')
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
