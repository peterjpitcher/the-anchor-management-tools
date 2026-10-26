'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Stat,
  StatGrid,
  SubHeading,
  Textarea,
  toast,
} from '@/ds'
import type { Event } from '@/types/database'
import type { EventBookingRow } from '@/app/actions/events'
import {
  getEventDoorTakings,
  recordEventBookingAttendance,
  saveEventDoorTakings,
  type EventDoorTakings,
} from '@/app/actions/event-outcomes'
import {
  canRecordAttendance,
  expectedDoorMoney,
  isStaffListCheckIn,
  resolveEventAttendance,
  summariseEventAttendance,
  type EventAttendance,
} from '@/lib/events/attendance'
import { resolveEventStartIso } from '@/lib/events/event-when'
import { resolveEventPaymentMode, resolveEventTicketPriceAmount } from '@/lib/events/pricing'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import { EVENT_ATTENDANCE_LABEL, EVENT_ATTENDANCE_TONE } from '../_shared/status-ui'

interface EventOutcomesCardProps {
  event: Event
  bookings: EventBookingRow[]
  canManage: boolean
  /** Reload the bookings after a change, so the attendee list agrees. */
  onChanged: () => Promise<void> | void
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount)
}

function seatsText(seats: number): string {
  return seats === 1 ? '1 seat' : `${seats} seats`
}

/**
 * Who came, and the door money on a pay-on-arrival night (BK-130, BK-118; owner decision D13).
 * Shown once the event has started. Staff tick who came on the night or the morning after; a
 * booking nobody ticks stays 'not recorded' and is never marked as a no-show automatically.
 */
export function EventOutcomesCard({ event, bookings, canManage, onChanged }: EventOutcomesCardProps) {
  const startIso = resolveEventStartIso(event)
  const started = startIso ? Date.parse(startIso) <= Date.now() : false
  const isPayOnArrival = resolveEventPaymentMode(event) === 'cash_only'
  const ticketPrice = resolveEventTicketPriceAmount(event)
  const [savingBookingId, setSavingBookingId] = useState<string | null>(null)

  const rows = useMemo(
    () =>
      bookings
        .filter((booking) => canRecordAttendance(booking))
        .map((booking) => ({
          booking,
          checkIn: booking.check_in ?? null,
          attendance: resolveEventAttendance(booking, booking.check_in ?? null),
          name: [booking.customer?.first_name, booking.customer?.last_name].filter(Boolean).join(' ') || 'Guest',
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [bookings],
  )
  const summary = useMemo(() => summariseEventAttendance(rows), [rows])

  const record = useCallback(async (bookingId: string, outcome: EventAttendance) => {
    setSavingBookingId(bookingId)
    try {
      const result = await recordEventBookingAttendance({ bookingId, outcome })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      await onChanged()
    } finally {
      setSavingBookingId(null)
    }
  }, [onChanged])

  if (!started) return null

  return (
    <Card>
      <CardHeader
        title="Who came?"
        action={summary.not_recorded.bookings > 0 ? (
          <Badge tone="warning">{summary.not_recorded.bookings} not recorded</Badge>
        ) : null}
      />
      <CardBody>
        <div className="space-y-5">
          <p className="text-sm text-text-muted">
            Tick who came, on the night or the morning after. Anyone left unticked stays &lsquo;not
            recorded&rsquo;: nobody is marked as a no-show automatically, and a no-show is not sent the review text.
          </p>

          <StatGrid columns={3}>
            <Stat label="Came" value={summary.came.bookings} hint={seatsText(summary.came.seats)} tone="success" />
            <Stat label="Did not come" value={summary.did_not_come.bookings} hint={seatsText(summary.did_not_come.seats)} />
            <Stat label="Not recorded" value={summary.not_recorded.bookings} hint={seatsText(summary.not_recorded.seats)} />
          </StatGrid>

          {isPayOnArrival && (
            <DoorMoneyPanel
              eventId={event.id}
              ticketPrice={ticketPrice}
              cameSeats={summary.came.seats}
              bookedSeats={summary.came.seats + summary.did_not_come.seats + summary.not_recorded.seats}
              attendanceRecorded={summary.came.bookings + summary.did_not_come.bookings > 0}
              canManage={canManage}
            />
          )}

          {rows.length === 0 ? (
            <p className="text-sm text-text-muted">No bookings to mark.</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => {
                const atTheDoor = row.checkIn !== null && !isStaffListCheckIn(row.checkIn)
                const saving = savingBookingId === row.booking.id
                return (
                  <li key={row.booking.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <span className="font-medium text-text-strong">{row.name}</span>
                      <span className="ml-2 text-sm text-text-muted">{seatsText(Number(row.booking.seats ?? 0))}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={EVENT_ATTENDANCE_TONE[row.attendance]} size="sm">
                        {atTheDoor ? 'Checked in at the door' : EVENT_ATTENDANCE_LABEL[row.attendance]}
                      </Badge>
                      {canManage && !atTheDoor && (
                        <>
                          {row.attendance !== 'came' && (
                            <Button size="sm" variant="secondary" loading={saving} onClick={() => record(row.booking.id, 'came')}>
                              Came
                            </Button>
                          )}
                          {row.attendance !== 'did_not_come' && (
                            <Button size="sm" variant="ghost" disabled={saving} onClick={() => record(row.booking.id, 'did_not_come')}>
                              Did not come
                            </Button>
                          )}
                          {row.attendance !== 'not_recorded' && (
                            <Button size="sm" variant="ghost" disabled={saving} onClick={() => record(row.booking.id, 'not_recorded')}>
                              Clear
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * A pay-on-arrival night's door money, kept as one till total (D13): what the till took for the
 * event, set against the seats that came at the ticket price. Free entries need a reason. The money
 * is already in the till and cash-up, so this explains it and is never added to sales.
 */
function DoorMoneyPanel({
  eventId,
  ticketPrice,
  cameSeats,
  bookedSeats,
  attendanceRecorded,
  canManage,
}: {
  eventId: string
  ticketPrice: number
  cameSeats: number
  bookedSeats: number
  attendanceRecorded: boolean
  canManage: boolean
}) {
  const [record, setRecord] = useState<EventDoorTakings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [tillTotal, setTillTotal] = useState('')
  const [freeEntries, setFreeEntries] = useState('0')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getEventDoorTakings(eventId).then((result) => {
      if (cancelled) return
      setLoaded(true)
      if (result.error) {
        setLoadError(result.error)
        return
      }
      const data = result.data ?? null
      setRecord(data)
      if (data) {
        setTillTotal(data.tillTotal.toFixed(2))
        setFreeEntries(String(data.freeEntries))
        setNote(data.note ?? '')
      }
    })
    return () => {
      cancelled = true
    }
  }, [eventId])

  const seatsForExpected = attendanceRecorded ? cameSeats : bookedSeats
  const expected = expectedDoorMoney(seatsForExpected, ticketPrice)
  const recordedTotal = record ? record.tillTotal : null
  const difference = recordedTotal === null ? null : Math.round((recordedTotal - expected) * 100) / 100

  const handleSave = async () => {
    setFormError(null)
    const total = Number(tillTotal)
    const free = Number(freeEntries || '0')
    if (tillTotal.trim() === '' || !Number.isFinite(total)) {
      setFormError('Enter what the till took for this event.')
      return
    }
    if (!Number.isInteger(free) || free < 0) {
      setFormError('Free entries must be a whole number.')
      return
    }
    setSaving(true)
    try {
      const result = await saveEventDoorTakings({
        eventId,
        tillTotal: total,
        freeEntries: free,
        note: note.trim() || undefined,
      })
      if ('error' in result) {
        setFormError(result.error)
        return
      }
      setRecord(result.data)
      toast.success('Door money saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SubHeading>Door money (till total)</SubHeading>
        {record && (
          <span className="text-xs text-text-muted">Last saved {formatDateTime12Hour(record.updatedAt)}</span>
        )}
      </div>
      <p className="text-sm text-text-muted">
        Expected at {formatCurrency(ticketPrice)} a head: {seatsText(seatsForExpected)}{' '}
        {attendanceRecorded ? 'came' : 'booked (nobody ticked yet)'} = {formatCurrency(expected)}.
        {difference !== null && difference !== 0 && (
          <> The till total is {formatCurrency(Math.abs(difference))} {difference < 0 ? 'under' : 'over'} that.</>
        )}
        {' '}This money is already in the till and the cash-up, so it is not added to sales again.
      </p>
      {loadError && <Alert tone="danger" size="sm">{loadError}</Alert>}
      {loaded && !loadError && canManage && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Till total for this event (£)"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={tillTotal}
            onChange={(e) => setTillTotal(e.target.value)}
            placeholder="0.00"
          />
          <Input
            label="Free entries"
            type="number"
            inputMode="numeric"
            min={0}
            step="1"
            value={freeEntries}
            onChange={(e) => setFreeEntries(e.target.value.replace(/\D/g, ''))}
          />
          <div className="sm:col-span-2">
            <Textarea
              label={Number(freeEntries || '0') > 0 ? 'Why were they let in free?' : 'Note (optional)'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              minRows={2}
            />
          </div>
          {formError && (
            <div className="sm:col-span-2">
              <Alert tone="danger" size="sm">{formError}</Alert>
            </div>
          )}
          <div className="sm:col-span-2">
            <Button size="sm" variant="primary" loading={saving} onClick={handleSave}>
              {record ? 'Update door money' : 'Save door money'}
            </Button>
          </div>
        </div>
      )}
      {loaded && !loadError && !canManage && record && (
        <p className="text-sm text-text">
          Till total {formatCurrency(record.tillTotal)}, free entries {record.freeEntries}
          {record.note ? ` (${record.note})` : ''}.
        </p>
      )}
    </div>
  )
}
