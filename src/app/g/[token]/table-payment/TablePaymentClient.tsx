'use client'

import { useState } from 'react'
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js'
// Imported file by file rather than through '@/components/features/guest': the
// barrel re-exports GuestShell, which loads the guest webfonts, and a font
// loader must not be pulled into a client module graph.
import { clsx } from 'clsx'
import { DetailRow } from '@/components/features/guest/DetailRow'
import { GuestAlert } from '@/components/features/guest/GuestAlert'
import { GuestAmount } from '@/components/features/guest/GuestAmount'
import { GuestButton } from '@/components/features/guest/GuestButton'
import { GuestCard } from '@/components/features/guest/GuestCard'
import { GuestIntro } from '@/components/features/guest/GuestIntro'
import { GuestHelpLine, GuestPhoneLink } from '@/components/features/guest/GuestLink'
import { TrustLine } from '@/components/features/guest/TrustLine'
import { GUEST_NOTE_CLASS } from '@/components/features/guest/styles'

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
      <GuestIntro kicker="Table booking" title="Complete your deposit payment" lead={greeting} />

      {/* Between the intro and the card, as on event-payment: every guest page leads with its h1. */}
      {showCancelledMessage && paymentState === 'idle' && (
        <GuestAlert tone="notice" role="alert" icon="clock">
          Payment was not completed. Your {isOutsideSeating ? 'booking' : 'table'} is still
          reserved if you pay before the hold expiry time below.
        </GuestAlert>
      )}

      <GuestCard variant="accent">
        <div className="flex flex-col gap-guest-lg">
          <GuestAmount label="Deposit due now" value={formatMoney(depositAmount, currency)} />

          <div>
            <DetailRow label="Booking reference" value={bookingReference} />
            <DetailRow label="Covers" value={`${partySize} ${seatWord}`} />
            <DetailRow
              label="Hold expires"
              value={formatLondonDateTime(holdExpiresAt)}
              emphasis="deadline"
            />
          </div>

          {holdExpired ? (
            <GuestAlert tone="problem" role="alert">
              This hold has expired. Please call us to arrange a new booking.
            </GuestAlert>
          ) : (
            // The pointer-events guard stops a second tap reaching PayPal while
            // the capture is running.
            <div className={clsx('flex flex-col gap-3', paymentState === 'paying' && 'pointer-events-none')}>
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
                <p className={clsx('text-center', GUEST_NOTE_CLASS)}>Processing payment, please wait…</p>
              )}

              <TrustLine />
            </div>
          )}
        </div>
      </GuestCard>

      <GuestHelpLine>
        Need help? Call <GuestPhoneLink />.
      </GuestHelpLine>
    </>
  )
}
