'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Alert, Button, Modal, toast } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import { acknowledgeHoursImpact } from '@/app/actions/business-hours'
import type { HoursImpact, HoursImpactItem } from '@/services/hours-impact'

/** What a save on this page says about the bookings it left outside the hours. */
export interface HoursImpactNotice {
  impact?: HoursImpact
  error?: string
}

interface HoursImpactDialogProps {
  notice: HoursImpactNotice | null
  onClose: () => void
}

const REASONS: Record<HoursImpactItem['reason'], string> = {
  closed: 'the pub is closed',
  kitchen_closed: 'the kitchen is closed',
  outside_hours: 'outside the opening hours',
  outside_kitchen_hours: 'food booking outside the kitchen hours',
}

function itemLabel(item: HoursImpactItem): string {
  const parts = [item.reference, item.label].filter(Boolean).join(': ')
  const size = item.guests ? `, ${item.guests} ${item.guests === 1 ? 'guest' : 'guests'}` : ''
  const at = item.time ? ` at ${item.time}` : ''
  const kind = item.kind === 'event' ? 'Event ' : item.kind === 'private_hire' ? 'Private hire ' : ''
  return `${kind}${parts}${size}${at}`
}

function itemHref(item: HoursImpactItem): string {
  if (item.kind === 'event') return `/events/${item.id}`
  if (item.kind === 'private_hire') return `/private-bookings/${item.id}`
  return `/table-bookings/${item.id}`
}

/**
 * After the opening hours change, the bookings already taken that no longer fit them (review
 * BK-076): table bookings on a closed day or outside the hours, food bookings when the kitchen is
 * shut, and events and private hires on a closed day. Nothing is moved, cancelled or messaged; the
 * manager opens each one, or the day's guest list to message them, and marks the list as checked,
 * which goes on the audit log.
 */
export function HoursImpactDialog({ notice, onClose }: HoursImpactDialogProps): React.ReactElement | null {
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)

  if (!notice) return null
  if (!notice.error && (!notice.impact || notice.impact.items.length === 0)) return null

  const items = notice.impact?.items ?? []
  const dates = Array.from(new Set(items.map((item) => item.date)))

  async function handleChecked(): Promise<void> {
    if (!notice?.impact || inFlight.current) return
    inFlight.current = true
    setPending(true)
    try {
      const result = await acknowledgeHoursImpact({
        from: notice.impact.from,
        to: notice.impact.to,
        items: notice.impact.items.map((item) => ({ kind: item.kind, id: item.id, date: item.date, reason: item.reason })),
      })
      if (!result.success) {
        toast.error(result.error ?? 'Nothing was recorded.')
        return
      }
      toast.success('Recorded that these bookings have been checked.')
      onClose()
    } catch {
      toast.error('Nothing was recorded: the request did not reach the server.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose()
      }}
      title="Bookings to check"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Close
          </Button>
          {items.length > 0 && (
            <Button type="button" variant="primary" onClick={handleChecked} loading={pending} disabled={pending}>
              Mark As Checked
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4 text-sm text-text">
        {notice.error && <Alert tone="warning">{notice.error}</Alert>}
        {items.length > 0 && (
          <>
            <p>
              These bookings were taken before the change and no longer fit the hours. Nothing has been moved or
              cancelled, and no guest has been told. Open each one, or a day&apos;s guest list to message them.
            </p>
            {dates.map((date) => (
              <div key={date} className="space-y-1">
                <p className="font-medium">
                  {formatDateInLondon(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}{' '}
                  <Link href={`/table-bookings/boh?date=${date}&view=day`} className="font-normal text-primary underline">
                    Message this day&apos;s guests
                  </Link>
                </p>
                <ul className="list-disc space-y-1 pl-5">
                  {items.filter((item) => item.date === date).map((item) => (
                    <li key={`${item.kind}-${item.id}`}>
                      <Link href={itemHref(item)} className="text-primary underline">
                        {itemLabel(item)}
                      </Link>
                      {`: ${REASONS[item.reason]}`}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>
    </Modal>
  )
}

/** The notice to show from an action's result, or null when there is nothing to say. */
export function hoursImpactNoticeFrom(result: object): HoursImpactNotice | null {
  const fields = result as { hoursImpact?: HoursImpact; hoursImpactError?: string }
  if (fields.hoursImpactError) return { error: fields.hoursImpactError, impact: fields.hoursImpact }
  if (fields.hoursImpact && fields.hoursImpact.items.length > 0) return { impact: fields.hoursImpact }
  return null
}
