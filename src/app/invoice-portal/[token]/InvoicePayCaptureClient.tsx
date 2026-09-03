'use client'

import { useEffect, useRef, useState } from 'react'
import { captureInvoicePaymentByToken } from '@/app/actions/invoicePayPalActions'

type Phase = 'capturing' | 'done' | 'error'

/**
 * Runs on the customer's return from PayPal.
 *
 * PayPal appends the order id as `?token=`, which collides confusingly with our
 * own portal token in the path; the one in the query string is always PayPal's.
 *
 * This is only one of four ways the payment gets recorded (the webhook, the
 * reconciliation cron and a staff-side retry are the others), and all of them
 * key on the same capture id, so arriving second is normal and harmless.
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
        // payment attempt, and so the figures above re-read from the database.
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
      <p role="status" className="mt-6 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Confirming your payment. Please don&apos;t close this page.
      </p>
    )
  }

  if (phase === 'done') {
    return (
      <p role="status" className="mt-6 rounded-lg bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
        Payment received. Thank you.
      </p>
    )
  }

  return (
    <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
      {message}
    </p>
  )
}
