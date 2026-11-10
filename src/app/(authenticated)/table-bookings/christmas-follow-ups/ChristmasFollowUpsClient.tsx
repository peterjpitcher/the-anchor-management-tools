'use client'

import { useState } from 'react'
import { Badge, Button, Card, CardBody, CardHeader, Empty, Modal, Textarea, toast } from '@/ds'
import { formatDateInLondon, formatDateTimeInLondon } from '@/lib/dateUtils'
import { markChristmasLeadCalled } from '@/app/actions/christmas-follow-ups'
import type { ChristmasFollowUpItem } from '@/lib/table-bookings/christmas-follow-up-list'

/**
 * The Christmas follow-ups call list (Christmas funnel spec, owner decision 7). One card per
 * unfinished booking, soonest date first. "Mark called" records who rang, with an optional note;
 * the guest stays on the list, marked as called, until the date passes.
 */

interface ChristmasFollowUpsClientProps {
  items: ChristmasFollowUpItem[]
  canEdit: boolean
}

/** "Tuesday 15 December", from the London date (never a weekday typed by hand). */
function describeDate(isoDate: string): string {
  return formatDateInLondon(`${isoDate}T12:00:00Z`, { weekday: 'long', day: 'numeric', month: 'long' })
}

function describeInstant(iso: string): string {
  return formatDateTimeInLondon(iso, { dateStyle: 'medium', timeStyle: 'short' })
}

function followUpBadge(item: ChristmasFollowUpItem): React.JSX.Element | null {
  if (item.source === 'lapsed_hold') return null
  switch (item.followUpEmail) {
    case 'sent':
      return <Badge tone="info">Follow-up email sent</Badge>
    case 'refused':
      return <Badge tone="warning">Follow-up email did not send</Badge>
    case 'uncertain':
      return <Badge tone="warning">Follow-up email may not have sent</Badge>
    case 'sending':
      return <Badge tone="neutral">Follow-up email sending</Badge>
    default:
      return <Badge tone="neutral">No follow-up email yet</Badge>
  }
}

export function ChristmasFollowUpsClient({ items, canEdit }: ChristmasFollowUpsClientProps): React.JSX.Element {
  const [rows, setRows] = useState<ChristmasFollowUpItem[]>(items)
  const [marking, setMarking] = useState<ChristmasFollowUpItem | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  function openMarkCalled(item: ChristmasFollowUpItem) {
    setMarking(item)
    setNote('')
    setProblem(null)
  }

  async function saveCalled() {
    if (!marking) return
    setSaving(true)
    setProblem(null)
    const trimmed = note.trim()
    const result = await markChristmasLeadCalled({ leadId: marking.leadId, ...(trimmed ? { note: trimmed } : {}) })
    setSaving(false)
    if (!result.success) {
      setProblem(result.error ?? 'That was not saved. Try again.')
      return
    }
    const calledAt = new Date().toISOString()
    setRows((current) =>
      current.map((row) => (row.leadId === marking.leadId ? { ...row, calledAt, callNote: trimmed || null } : row)),
    )
    setMarking(null)
    toast.success('Marked as called')
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardBody>
          <Empty
            title="Nobody to follow up"
            description="Unfinished Christmas dinner bookings from today onward appear here."
          />
        </CardBody>
      </Card>
    )
  }

  const toCall = rows.filter((row) => !row.calledAt && !row.bookedSince).length

  return (
    <>
      <Card>
        <CardHeader
          title={`To call: ${toCall} of ${rows.length}`}
          subtitle="Started online and not finished, or a deposit that was not paid in time"
        />
        <CardBody className="space-y-4">
          {rows.map((item) => (
            <div key={item.leadId} className="space-y-1 border-b border-border pb-4 last:border-b-0 last:pb-0">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-text">{item.guestName ?? 'Guest'}</span>
                {item.source === 'lapsed_hold' ? (
                  <Badge tone="warning">Deposit not paid in time</Badge>
                ) : (
                  <Badge tone="neutral">Started online</Badge>
                )}
                {followUpBadge(item)}
                {item.optedOut ? <Badge tone="neutral">Asked for no emails</Badge> : null}
                {item.bookedSince ? <Badge tone="success">Has a Christmas booking now</Badge> : null}
              </p>
              <p className="text-sm text-text">
                {describeDate(item.bookingDate)} at {item.bookingTime}, {item.partySize}{' '}
                {item.partySize === 1 ? 'person' : 'people'}
              </p>
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {item.phone ? (
                  <a href={`tel:${item.phone}`} className="font-semibold text-primary underline">
                    {item.phone}
                  </a>
                ) : (
                  <span className="text-text-muted">No phone number</span>
                )}
                {item.email ? (
                  <a href={`mailto:${item.email}`} className="text-primary underline">
                    {item.email}
                  </a>
                ) : (
                  <span className="text-text-muted">No email address</span>
                )}
              </p>
              <p className="text-xs text-text-muted">Started {describeInstant(item.startedAt)}</p>
              {item.calledAt ? (
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge tone="success">Called {describeInstant(item.calledAt)}</Badge>
                  {item.callNote ? <span className="text-text-muted">{item.callNote}</span> : null}
                </p>
              ) : canEdit ? (
                <div>
                  <Button size="sm" variant="secondary" onClick={() => openMarkCalled(item)}>
                    Mark called
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </CardBody>
      </Card>

      <Modal
        open={marking !== null}
        onClose={() => (saving ? undefined : setMarking(null))}
        title="Mark called"
        description={marking ? `${marking.guestName ?? 'Guest'}, ${describeDate(marking.bookingDate)}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMarking(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void saveCalled()} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <Textarea
          label="Note (optional)"
          hint="For example: rebooking on the phone, or not coming this year."
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
        />
        {problem ? (
          <p className="mt-2 text-sm font-semibold text-danger-fg" role="alert">
            {problem}
          </p>
        ) : null}
      </Modal>
    </>
  )
}
