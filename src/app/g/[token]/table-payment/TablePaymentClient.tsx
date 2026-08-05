'use client'

import { useState } from 'react'
import { Clock } from 'lucide-react'
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js'
// Imported file by file rather than through '@/components/features/guest': the
// barrel re-exports GuestShell, which loads the guest webfonts, and a font
// loader must not be pulled into a client module graph.
import { DetailRow } from '@/components/features/guest/DetailRow'
import { GuestAlert } from '@/components/features/guest/GuestAlert'
import { GuestAmount } from '@/components/features/guest/GuestAmount'
import { GuestCard } from '@/components/features/guest/GuestCard'
import { TrustLine } from '@/components/features/guest/TrustLine'
import {
  GUEST_H1_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
} from '@/components/features/guest/styles'
import { GUEST_CONTACT } from '@/lib/guest-contact'

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
  // Outside bookings hold no indoor table, so the "reserved" copy stays table-free.
  isOutsideSeating?: boolean
  /** Greeting line under the h1, computed on the server from the customer record. */
  greeting: string
  /**
   * The whole success state, computed on the server (spec, "table-payment
   * success-state boundary"). This component owns everything below
   * `GuestShell`, so on capture success it swaps the entire page body, h1
   * included, with no refresh and no second trip to the server.
   */
  success: React.ReactNode
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
    hourCycle: 'h12',
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
  isOutsideSeating = false,
  greeting,
  success,
}: TablePaymentClientProps) {
  const [paymentState, setPaymentState] = useState<PaymentState>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const holdExpired = new Date(holdExpiresAt) < new Date()
  const seatWord = partySize === 1 ? 'person' : 'people'

  if (paymentState === 'success') {
    return <>{success}</>
  }

  return (
    <>
      {showCancelledMessage && paymentState === 'idle' && (
        <GuestAlert tone="notice" role="alert" icon={Clock}>
          Payment was not completed. Your {isOutsideSeating ? 'booking' : 'table'} is still
          reserved if you pay before the hold expiry time below.
        </GuestAlert>
      )}

      <div className={GUEST_INTRO_CLASS}>
        <p className={GUEST_KICKER_CLASS}>Table booking</p>
        <h1 className={GUEST_H1_CLASS}>Complete your deposit payment</h1>
        <p className={GUEST_LEAD_CLASS}>{greeting}</p>
      </div>

      <GuestCard variant="accent">
        <GuestAmount label="Deposit due now" value={formatMoney(depositAmount, currency)} />

        <div className="mt-[18px]">
          <DetailRow label="Booking reference" value={bookingReference} />
          <DetailRow label="Covers" value={`${partySize} ${seatWord}`} />
          <DetailRow
            label="Hold expires"
            value={formatLondonDateTime(holdExpiresAt)}
            emphasis="deadline"
          />
        </div>

        {holdExpired ? (
          <GuestAlert tone="problem" role="alert" className="mt-[18px]">
            This hold has expired. Please call us to arrange a new booking.
          </GuestAlert>
        ) : (
          <div
            className="mt-[18px] flex flex-col gap-3"
            style={{ pointerEvents: paymentState === 'paying' ? 'none' : 'auto' }}
          >
            {paymentState === 'error' && (
              <GuestAlert tone="problem" role="alert">
                {errorMessage || 'Payment failed. Please try again.'}
                <button
                  type="button"
                  className="ml-2 font-semibold text-anchor-danger underline underline-offset-2"
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
                currency: currency,
                intent: 'capture',
                environment: paypalEnvironment === 'sandbox' ? 'sandbox' : 'production',
              }}
            >
              {/* PayPal's own button. Never restyle it: this style prop is fixed. */}
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
                    setErrorMessage(
                      'An unexpected error occurred. Please call us to confirm your payment.'
                    )
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
              <p className="text-center font-anchor-body text-[12px] leading-[1.5] text-guest-text-muted">
                Processing payment, please wait…
              </p>
            )}

            <TrustLine />
          </div>
        )}
      </GuestCard>

      <p className="text-center font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
        Need help? Call{' '}
        <a
          href={GUEST_CONTACT.telHref}
          referrerPolicy="no-referrer"
          className="font-semibold text-guest-accent-text no-underline hover:underline"
        >
          {GUEST_CONTACT.phoneDisplay}
        </a>
        .
      </p>
    </>
  )
}
