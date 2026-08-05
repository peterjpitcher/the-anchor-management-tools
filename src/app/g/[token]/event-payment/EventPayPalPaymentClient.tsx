'use client'

import { useState } from 'react'
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js'
import { GuestAlert, TrustLine } from '@/components/features/guest'

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
      className="flex flex-col gap-3"
      style={{ pointerEvents: paymentState === 'creating' || paymentState === 'paying' ? 'none' : 'auto' }}
    >
      {paymentState === 'error' && (
        <GuestAlert tone="problem" role="alert">
          {errorMessage || 'Payment failed. Please try again.'}
          <button
            type="button"
            className="ml-2 font-semibold underline underline-offset-[3px]"
            onClick={() => {
              setErrorMessage(null)
              setPaymentState('idle')
            }}
          >
            Try again
          </button>
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
        <p className="text-center font-anchor-body text-[12px] leading-[1.5] text-guest-text-muted">
          Processing payment, please wait.
        </p>
      )}

      <TrustLine />

      <p className="text-center font-anchor-body text-[12px] leading-[1.5] text-guest-text-muted">
        If PayPal does not load,{' '}
        <a
          className="font-medium text-guest-accent-text underline underline-offset-[3px]"
          href={fallbackUrl}
          referrerPolicy="no-referrer"
        >
          refresh this payment page
        </a>
        .
      </p>
    </div>
  )
}
