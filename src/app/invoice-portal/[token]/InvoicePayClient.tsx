'use client'

import { useState } from 'react'
// Orange Jelly invoices use the neutral staff components, not the Anchor guest ones.
import { Button } from '@/ds'
import { StatusNote } from './StatusNote'
import { createInvoicePaymentOrderByToken } from '@/app/actions/invoicePayPalActions'

/**
 * The pay button.
 *
 * The PayPal order is created when the customer presses this, never on page
 * load: email scanners and link previewers open these URLs, and opening a
 * payment order because a spam filter looked at the message is not something to
 * do by accident. It also means a link in an old email never goes stale, since
 * a fresh PayPal order is minted at the moment of pressing.
 */
export function InvoicePayClient({ token, amountDue }: { token: string; amountDue: number }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amount = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(amountDue)

  async function handlePay() {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await createInvoicePaymentOrderByToken(token)
      if (result.error || !result.approveUrl) {
        setError(result.error || 'We could not start that payment. Please try again.')
        return
      }
      window.location.href = result.approveUrl
    } catch {
      setError('We could not start that payment. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <StatusNote tone="problem" role="alert">
          {error}
        </StatusNote>
      )}

      <Button
        type="button"
        variant="primary"
        size="lg"
        className="w-full"
        onClick={handlePay}
        disabled={loading}
      >
        {loading ? 'Taking you to PayPal…' : `Pay ${amount}`}
      </Button>

      <p className="text-center text-ui leading-relaxed text-text-muted">
        You do not need a PayPal account. You can pay by card there too.
      </p>
    </div>
  )
}
