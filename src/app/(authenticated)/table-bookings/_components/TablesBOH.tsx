'use client'

import { Card, CardBody } from '@/ds'
import { Badge, Alert } from '@/ds'
import type { Booking } from './TableBookingsClient'

/* ------------------------------------------------------------------ */
/*  BOH View — ticket-style kitchen cards                              */
/* ------------------------------------------------------------------ */

interface TablesBOHProps {
  bookings: Booking[]
}

export function TablesBOH({ bookings }: TablesBOHProps) {
  const activeBookings = bookings.filter((b) => b.status === 'seated' || b.status === 'confirmed')

  if (activeBookings.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-text-muted text-center py-8">No active bookings for kitchen display.</p>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {activeBookings.map((booking) => (
        <Card key={booking.id} className="border-l-4 border-l-primary">
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-text-strong">{booking.tableName}</h4>
              <Badge tone={booking.status === 'seated' ? 'success' : 'info'}>
                {booking.status}
              </Badge>
            </div>

            <div className="space-y-1">
              <p className="text-sm text-text">{booking.guestName} - {booking.partySize} covers</p>
              <p className="text-xs text-text-muted">{booking.startTime} - {booking.endTime}</p>
            </div>

            {booking.notes && (
              <Alert tone="warning" title="Special Requirements">
                {booking.notes}
              </Alert>
            )}

            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="inline-block w-2 h-2 rounded-full bg-success" />
              <span>Awaiting starters</span>
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  )
}
