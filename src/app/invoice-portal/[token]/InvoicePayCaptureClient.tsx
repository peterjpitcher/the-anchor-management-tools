'use client'

import { useEffect, useRef, useState } from 'react'
import { GuestAlert } from '@/components/features/guest/GuestAlert'
import { captureInvoicePaymentByToken } from '@/app/actions/invoicePayPalActions'

type Phase = 'capturing' | 'done' | 'error'

/**
 * Runs on the customer's return from PayPal.
 *
 * This is only one of the ways a payment gets recorded: the webhook and the
 * reconciliation cron cover the same ground, and all of them key on the same
 * capture id, so arriving second is normal and records nothing twice.
 */
export function InvoicePayCaptureClient({
  token,
  paypalOrderId,
}: {
  token: string
  paypalOrderId: string
}) {
  const [phase, setPhase] = useState<Phase>('capturing')
  const [message, setMessage] = useState<string | null>(null)
  const attempted = useRef(false)

  useEffect(() => {
    if (attempted.current) return
    attempted.current = true

    let cancelled = false

    void (async () => {
      try {
        const result = await captureInvoicePaymentByToken(token, paypalOrderId)
        if (cancelled) return

        if (result.error) {
          setPhase('error')
          setMessage(result.error)
          return
        }

        setPhase('done')
        setMessage(null)
        // Drop the PayPal query string so a refresh does not look like a second
        // payment attempt, and so the figures re-read from the database.
        setTimeout(() => {
          if (!cancelled) window.location.replace(window.location.pathname)
        }, 1500)
      } catch {
        if (!cancelled) {
          setPhase('error')
          setMessage('We could not confirm that payment. Please contact us before paying again.')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [token, paypalOrderId])

  if (phase === 'capturing') {
    return (
      <GuestAlert tone="notice" role="status" live="polite" className="mb-[18px]">
        Confirming your payment. Please don&apos;t close this page.
      </GuestAlert>
    )
  }

  if (phase === 'done') {
    return (
      <GuestAlert tone="success" role="status" live="polite" className="mb-[18px]">
        Payment received. Thank you.
      </GuestAlert>
    )
  }

  return (
    <GuestAlert tone="problem" role="alert" className="mb-[18px]">
      {message}
    </GuestAlert>
  )
}
