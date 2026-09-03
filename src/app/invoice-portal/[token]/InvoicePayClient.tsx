'use client'

import { useState } from 'react'
import { createInvoicePaymentOrderByToken } from '@/app/actions/invoicePayPalActions'

/**
 * The pay button.
 *
 * The PayPal order is created when the customer presses this, never on page
 * load: email scanners and link previewers open these URLs, and opening a
 * payment order because a spam filter looked at the message is not something to
 * do by accident. It also means the link in an old email never goes stale, as
 * a fresh PayPal order is minted at the moment of pressing.
 */
export function InvoicePayClient({ token, amountDue }: { token: string; amountDue: number }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amount = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amountDue)

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
    <div>
      <button
        type="button"
        onClick={handlePay}
        disabled={loading}
        className="flex w-full items-center justify-center rounded-lg bg-[#0070ba] px-6 py-4 text-base font-bold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Taking you to PayPal…' : `Pay ${amount} via PayPal`}
      </button>

      <p className="mt-3 text-center text-xs text-gray-500">
        You&apos;ll be taken to PayPal to pay securely. You do not need a PayPal account:
        you can pay by card there.
      </p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  )
}
