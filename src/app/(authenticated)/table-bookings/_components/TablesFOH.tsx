'use client'

import { Card, CardBody } from '@/ds'
import { Badge, Button } from '@/ds'
import type { Booking, TableInfo } from './TableBookingsClient'

/* ------------------------------------------------------------------ */
/*  FOH View — action-oriented table cards                             */
/* ------------------------------------------------------------------ */

const statusColors: Record<string, string> = {
  available: 'border-l-success',
  occupied: 'border-l-warning',
  reserved: 'border-l-info',
  blocked: 'border-l-border-strong',
}

interface TablesFOHProps {
  tables: TableInfo[]
  bookings: Booking[]
}

export function TablesFOH({ tables, bookings }: TablesFOHProps) {
  const bookingMap = new Map<string, Booking>()
  for (const b of bookings) {
    if (b.status === 'seated' || b.status === 'confirmed') {
      bookingMap.set(b.tableId, b)
    }
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      {tables.map((table) => {
        const booking = bookingMap.get(table.id)

        return (
          <Card key={table.id} className={`border-l-4 ${statusColors[table.status] || ''}`}>
            <CardBody className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-text-strong">{table.name}</h4>
                <Badge tone={table.status === 'available' ? 'success' : table.status === 'occupied' ? 'warning' : 'info'}>
                  {table.status}
                </Badge>
              </div>

              <p className="text-xs text-text-muted">Capacity: {table.capacity} - {table.section}</p>

              {booking && (
                <div className="rounded-md bg-surface-2 p-2 space-y-1">
                  <p className="text-sm font-medium text-text">{booking.guestName}</p>
                  <p className="text-xs text-text-muted">{booking.partySize} guests - {booking.startTime} to {booking.endTime}</p>
                </div>
              )}

              <div className="flex items-center gap-2">
                {table.status === 'available' && (
                  <Button size="sm" variant="secondary">Seat</Button>
                )}
                {table.status === 'occupied' && (
                  <>
                    <Button size="sm" variant="secondary">Clear</Button>
                    <Button size="sm" variant="ghost">Transfer</Button>
                  </>
                )}
                {table.status === 'reserved' && (
                  <Button size="sm" variant="secondary">Seat Now</Button>
                )}
              </div>
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}
