'use client'

import { useCallback, useState } from 'react'
import { createDepositPaymentOrderByToken } from '@/app/actions/portalPayPalActions'
import { GuestAlert, GuestButton } from '@/components/features/guest'

interface FreshPayPalLinkClientProps {
  portalToken: string
}

/**
 * The deposit call to action.
 *
 * This does not embed PayPal buttons. It asks the server to create an order and
 * then sends the browser to PayPal's approval URL, so the amount is only ever
 * decided server-side and no figure is passed in here.
 */
export function FreshPayPalLinkClient({ portalToken }: FreshPayPalLinkClientProps) {
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const createFreshLink = useCallback(async () => {
    setLoading(true)
    setErrorMessage(null)

    try {
      const result = await createDepositPaymentOrderByToken(portalToken)
      if (result.success && result.approveUrl) {
        window.location.href = result.approveUrl
        return
      }

      setErrorMessage(result.error || 'Unable to create a fresh payment link.')
    } catch {
      setErrorMessage('Unable to create a fresh payment link. Please contact us.')
    } finally {
      setLoading(false)
    }
  }, [portalToken])

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-[3px]">
        <p className="font-anchor-body text-[14px] font-semibold leading-[1.4] text-guest-text">
          Deposit payment link
        </p>
        <p className="font-anchor-body text-[12px] leading-[1.6] text-guest-text-muted">
          PayPal links usually expire after 6 hours. Use this button to create a fresh link.
        </p>
      </div>

      <GuestButton
        variant="primary"
        size="md"
        fullWidth
        disabled={loading}
        onClick={() => {
          if (!loading) void createFreshLink()
        }}
      >
        {loading ? 'Creating link...' : 'Pay deposit via PayPal'}
      </GuestButton>

      {errorMessage && <GuestAlert tone="problem">{errorMessage}</GuestAlert>}
    </div>
  )
}
