'use client'

/**
 * "Send Food Link" and "Copy Link" on the booking detail page (spec section 3.5).
 *
 * Send asks first, then emails the organiser their link to choose everyone's food, or texts it when
 * they have no usable email address. Whatever happens is said on screen, success or failure, and
 * stays there until the next attempt, because a toast that vanishes is easy to miss while on the phone.
 *
 * Copy makes a new link every time. Links are stored scrambled, so the one the organiser already has
 * cannot be read back; the screen says so, and the old link keeps working.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alert, Button, ConfirmDialog, SubHeading, toast } from '@/ds'
import { copyPreorderFoodLink, sendPreorderFoodLink } from './actions'

interface FoodLinkActionsProps {
  tableBookingId: string
  /** True once the cutoff has passed: the organiser can only view their choices then. */
  closed: boolean
  /** False for a booking still waiting for its deposit, or cancelled: the server refuses either way. */
  bookingConfirmed: boolean
}

type Notice = { tone: 'success' | 'danger' | 'info'; title: string; body: string; url?: string }

export function FoodLinkActions({ tableBookingId, closed, bookingConfirmed }: FoodLinkActionsProps) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [copying, setCopying] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  async function handleSend() {
    setSending(true)
    try {
      const result = await sendPreorderFoodLink(tableBookingId)
      if (result.error) {
        setNotice({ tone: 'danger', title: 'Food link not sent', body: result.error })
        toast.error(result.error)
        return
      }
      const body = result.message ?? 'Food link sent to the organiser.'
      setNotice({ tone: 'success', title: 'Food link sent', body })
      toast.success(body)
      router.refresh()
    } catch {
      const body = 'The food link did not send. Try again in a minute, or copy the link and send it another way.'
      setNotice({ tone: 'danger', title: 'Food link not sent', body })
      toast.error(body)
    } finally {
      setSending(false)
      setConfirming(false)
    }
  }

  async function handleCopy() {
    setCopying(true)
    try {
      const result = await copyPreorderFoodLink(tableBookingId)
      if (result.error || !result.url) {
        const body = result.error ?? 'Could not make a food link.'
        setNotice({ tone: 'danger', title: 'No link made', body })
        toast.error(body)
        return
      }
      try {
        await navigator.clipboard.writeText(result.url)
        setNotice({ tone: 'info', title: 'Link copied', body: result.message ?? 'New link made and copied.' })
        toast.success('Food link copied')
      } catch {
        // The browser refused the clipboard. The link is still good, so show it to copy by hand.
        setNotice({
          tone: 'info',
          title: 'Copy this link',
          body: 'The browser would not copy it for you. Select the link below and copy it.',
          url: result.url,
        })
      }
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <SubHeading>Food Link</SubHeading>
      <p className="text-sm text-text">
        {closed
          ? 'Choices have closed, so the organiser can only view them now. You can still copy their link.'
          : "Send the organiser their link to choose everyone's food, or copy it to send another way."}{' '}
        Copying makes a new link each time, because links are stored scrambled and cannot be read back.
        Any link the organiser already has keeps working.
      </p>
      {!bookingConfirmed && (
        <p className="text-xs text-text-muted">The food link can be sent once the booking is confirmed.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => setConfirming(true)}
          loading={sending}
          disabled={sending || closed || !bookingConfirmed}
        >
          Send Food Link
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={handleCopy}
          loading={copying}
          disabled={copying || !bookingConfirmed}
        >
          Copy Link
        </Button>
      </div>
      {notice && (
        <Alert tone={notice.tone} role={notice.tone === 'danger' ? 'alert' : 'status'} title={notice.title}>
          {notice.body}
          {notice.url && <p className="mt-1 break-all font-mono text-xs">{notice.url}</p>}
        </Alert>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={handleSend}
        title="Send the food link?"
        message="We'll email the organiser their link to choose everyone's food. If they have no email address we can use, we'll text it instead."
        confirmLabel="Send Link"
        tone="primary"
      />
    </div>
  )
}
