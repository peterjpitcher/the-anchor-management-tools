'use client'

import { useState } from 'react'
// Imported file by file rather than through '@/components/features/guest': the
// barrel re-exports GuestShell, which loads the guest webfonts, and a font
// loader must not be pulled into a client module graph.
import { GuestAlert } from '@/components/features/guest/GuestAlert'
import { GuestButton } from '@/components/features/guest/GuestButton'
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
        <GuestAlert tone="problem" role="alert">
          {error}
        </GuestAlert>
      )}

      <GuestButton
        as="button"
        type="button"
        variant="primary"
        size="lg"
        fullWidth
        onClick={handlePay}
        disabled={loading}
      >
        {loading ? 'Taking you to PayPal…' : `Pay ${amount}`}
      </GuestButton>

      <p className="text-center font-anchor-body text-[13px] leading-[1.6] text-guest-text-muted">
        You do not need a PayPal account. You can pay by card there too.
      </p>
    </div>
  )
}
