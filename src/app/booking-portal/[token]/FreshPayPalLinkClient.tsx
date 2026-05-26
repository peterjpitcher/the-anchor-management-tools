'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createDepositPaymentOrderByToken } from '@/app/actions/portalPayPalActions'

interface FreshPayPalLinkClientProps {
  portalToken: string
  autoStart?: boolean
}

export function FreshPayPalLinkClient({ portalToken, autoStart = false }: FreshPayPalLinkClientProps) {
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const autoStartedRef = useRef(false)

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

  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return
    autoStartedRef.current = true
    void createFreshLink()
  }, [autoStart, createFreshLink])

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">Deposit payment link</p>
      <p className="mt-1 text-sm text-amber-800">
        PayPal links usually expire after 6 hours. Use this button to create a fresh link.
      </p>
      <button
        type="button"
        onClick={() => {
          if (!loading) void createFreshLink()
        }}
        disabled={loading}
        className="mt-3 inline-flex min-h-10 items-center justify-center rounded-md bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? 'Creating link...' : 'Pay deposit via PayPal'}
      </button>
      {errorMessage && (
        <p className="mt-2 text-sm text-red-700">{errorMessage}</p>
      )}
    </div>
  )
}
