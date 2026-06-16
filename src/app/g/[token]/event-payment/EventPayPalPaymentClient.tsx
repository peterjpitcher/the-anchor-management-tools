'use client'

import { useState } from 'react'
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js'

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
      <div role="alert" className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Online payment is temporarily unavailable. Please call us, or try the payment link again shortly.
      </div>
    )
  }

  if (paymentState === 'success') {
    return (
      <div role="status" className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
        Payment received. Your booking is confirmed and we will send confirmation shortly.
      </div>
    )
  }

  if (paymentState === 'manual_review') {
    return (
      <div role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        Payment received. Staff need to check your booking before confirming. We will contact you shortly.
      </div>
    )
  }

  return (
    <div className="mt-6" style={{ pointerEvents: paymentState === 'creating' || paymentState === 'paying' ? 'none' : 'auto' }}>
      {paymentState === 'error' && (
        <div role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {errorMessage || 'Payment failed. Please try again.'}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => {
              setErrorMessage(null)
              setPaymentState('idle')
            }}
          >
            Try again
          </button>
        </div>
      )}

      <PayPalScriptProvider
        options={{
          clientId: paypalClientId,
          currency,
          intent: 'capture',
          environment: paypalEnvironment === 'sandbox' ? 'sandbox' : 'production',
        }}
      >
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
        <p className="mt-2 text-center text-xs text-slate-500">Processing payment, please wait.</p>
      )}

      <p className="mt-3 text-center text-xs text-slate-500">
        If PayPal does not load, <a className="underline" href={fallbackUrl}>refresh this payment page</a>.
      </p>
    </div>
  )
}
