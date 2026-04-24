'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { captureDepositPaymentByToken } from '@/app/actions/portalPayPalActions'

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
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 mb-4 text-sm text-blue-800">
        <strong>Processing your payment...</strong> Please wait while we confirm your deposit.
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-4 mb-4 text-sm text-green-800">
        <strong>Payment confirmed — thank you!</strong> Your deposit has been received and your booking is confirmed.
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 mb-4 text-sm text-red-800">
        <strong>Payment issue</strong> — {errorMessage} If you need help, please call us.
      </div>
    )
  }

  return null
}
