'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { captureDepositPaymentByToken } from '@/app/actions/portalPayPalActions'
import { GuestAlert } from '@/components/features/guest'

interface PayPalCaptureClientProps {
  portalToken: string
  depositPaid: boolean
}

export function PayPalCaptureClient({ portalToken, depositPaid }: PayPalCaptureClientProps) {
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'idle' | 'capturing' | 'success' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [captureAttempted, setCaptureAttempted] = useState(false)

  useEffect(() => {
    // PayPal appends token=ORDER_ID to the return URL
    const paymentPending = searchParams.get('payment_pending')
    const paypalOrderId = searchParams.get('token')

    if (paymentPending !== '1' || !paypalOrderId || depositPaid || captureAttempted) return

    setCaptureAttempted(true)
    setStatus('capturing')

    captureDepositPaymentByToken(portalToken, paypalOrderId)
      .then((result) => {
        if (result.success) {
          setStatus('success')
          // Reload to show updated booking state from the server component
          setTimeout(() => window.location.replace(window.location.pathname), 1500)
        } else {
          setStatus('error')
          setErrorMessage(result.error || 'Something went wrong')
        }
      })
      .catch(() => {
        setStatus('error')
        setErrorMessage('Unable to confirm your payment. Please contact us.')
      })
  }, [searchParams, portalToken, depositPaid, captureAttempted])

  if (status === 'idle') return null

  if (status === 'capturing') {
    return (
      <GuestAlert tone="notice" title="Processing your payment...">
        Please wait while we confirm your deposit.
      </GuestAlert>
    )
  }

  if (status === 'success') {
    return (
      <GuestAlert tone="success" title="Payment confirmed, thank you!">
        Your deposit has been received and your booking is confirmed.
      </GuestAlert>
    )
  }

  if (status === 'error') {
    return (
      <GuestAlert tone="problem" title="Payment issue">
        {errorMessage} If you need help, please call us.
      </GuestAlert>
    )
  }

  return null
}
