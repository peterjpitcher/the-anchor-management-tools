'use client'

import { useState } from 'react'
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js'

interface TablePaymentClientProps {
  orderId: string
  bookingReference: string
  depositAmount: number
  currency: string
  partySize: number
  holdExpiresAt: string
  showCancelledMessage: boolean
  paypalClientId: string
  paypalEnvironment: string
  captureAction: (orderId: string) => Promise<{ success: boolean; error?: string }>
}

type PaymentState = 'idle' | 'paying' | 'success' | 'error'

function formatMoney(amount: number, currency = 'GBP'): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
  }).format(amount)
}

function formatLondonDateTime(isoDateTime: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoDateTime))
}

export function TablePaymentClient({
  orderId,
  bookingReference,
  depositAmount,
  currency,
  partySize,
  holdExpiresAt,
  showCancelledMessage,
  paypalClientId,
  paypalEnvironment,
  captureAction,
}: TablePaymentClientProps) {
  const [paymentState, setPaymentState] = useState<PaymentState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const holdExpired = new Date(holdExpiresAt) < new Date()
  const seatWord = partySize === 1 ? 'person' : 'people'

  if (paymentState === 'success') {
    return (
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Deposit received!</h2>
        <p className="mt-2 text-sm text-slate-700">
          Thank you — your deposit payment has been received. We are confirming your booking now. You will receive a text confirmation shortly.
        </p>
      </div>
    )
  }

  return (
    <div>
      {showCancelledMessage && paymentState === 'idle' && (
        <div role="alert" className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Payment was not completed. Your table is still reserved if you pay before the hold expiry time below.
        </div>
      )}

      <p className="text-sm text-slate-700">
        Booking reference: <span className="font-medium">{bookingReference}</span>
      </p>
      <p className="mt-2 text-sm text-slate-700">
        Covers: <span className="font-medium">{partySize} {seatWord}</span>
      </p>
      <p className="mt-2 text-sm text-slate-700">
        Deposit due now: <span className="font-medium">{formatMoney(depositAmount, currency)}</span>
      </p>
      <p className="mt-2 text-sm text-slate-700">
        Hold expires: <span className="font-medium">{formatLondonDateTime(holdExpiresAt)}</span>
      </p>

      {holdExpired ? (
        <div role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          This hold has expired. Please call us to arrange a new booking.
        </div>
      ) : (
        <div className="mt-6" style={{ pointerEvents: paymentState === 'paying' ? 'none' : 'auto' }}>
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
              currency: currency,
              intent: 'capture',
              environment: paypalEnvironment === 'sandbox' ? 'sandbox' : 'production',
            }}
          >
            <PayPalButtons
              style={{ layout: 'vertical', shape: 'rect' }}
              disabled={paymentState === 'paying'}
              createOrder={() => {
                setPaymentState('paying')
                return Promise.resolve(orderId)
              }}
              onApprove={async () => {
                try {
                  const result = await captureAction(orderId)
                  if (result.success) {
                    setPaymentState('success')
                  } else {
                    setErrorMessage(result.error || 'Payment capture failed. Please call us.')
                    setPaymentState('error')
                  }
                } catch {
                  setErrorMessage('An unexpected error occurred. Please call us to confirm your payment.')
                  setPaymentState('error')
                }
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

          {paymentState === 'paying' && (
            <p className="mt-2 text-center text-xs text-slate-500">Processing payment, please wait…</p>
          )}
        </div>
      )}
    </div>
  )
}
