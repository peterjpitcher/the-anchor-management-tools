'use client'

import { useMemo } from 'react'
import { Card, CardBody } from '@/ds'
import { Badge } from '@/ds'
import type { Booking, TableInfo } from './TableBookingsClient'

/* ------------------------------------------------------------------ */
/*  Timeline constants                                                 */
/* ------------------------------------------------------------------ */

const START_HOUR = 11
const END_HOUR = 23
const SLOT_MINUTES = 30
const TOTAL_SLOTS = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES

function timeToSlotIndex(time: string): number {
  const [h, m] = time.split(':').map(Number)
  const minutesFromStart = (h - START_HOUR) * 60 + m
  return Math.max(0, Math.floor(minutesFromStart / SLOT_MINUTES))
}

function slotSpan(startTime: string, endTime: string): number {
  const startSlot = timeToSlotIndex(startTime)
  const endSlot = timeToSlotIndex(endTime)
  return Math.max(1, endSlot - startSlot)
}

const statusColors: Record<string, string> = {
  confirmed: 'bg-primary-soft text-primary-soft-fg',
  seated: 'bg-success-soft text-success-fg',
  completed: 'bg-surface-2 text-text-muted',
  cancelled: 'bg-danger-soft text-danger-fg',
  'no-show': 'bg-warning-soft text-warning-fg',
  waitlist: 'bg-info-soft text-info-fg',
}

/* ------------------------------------------------------------------ */
/*  Time labels                                                        */
/* ------------------------------------------------------------------ */

function timeLabels(): string[] {
  const labels: string[] = []
  for (let i = 0; i < TOTAL_SLOTS; i++) {
    const totalMinutes = START_HOUR * 60 + i * SLOT_MINUTES
    const h = Math.floor(totalMinutes / 60)
    const m = totalMinutes % 60
    labels.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`)
  }
  return labels
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

interface TimelineViewProps {
  bookings: Booking[]
  tables: TableInfo[]
}

export function TimelineView({ bookings, tables }: TimelineViewProps) {
  const labels = useMemo(() => timeLabels(), [])
  const uniqueTables = useMemo(() => {
    const seen = new Set<string>()
    return tables.filter((t) => { if (seen.has(t.id)) return false; seen.add(t.id); return true })
  }, [tables])

  const bookingsByTable = useMemo(() => {
    const map = new Map<string, Booking[]>()
    for (const b of bookings) {
      if (!map.has(b.tableId)) map.set(b.tableId, [])
      map.get(b.tableId)!.push(b)
    }
    return map
  }, [bookings])

  return (
    <Card>
      <CardBody className="p-0 overflow-x-auto">
        <div
          className="min-w-[900px]"
          style={{
            display: 'grid',
            gridTemplateColumns: `120px repeat(${TOTAL_SLOTS}, minmax(40px, 1fr))`,
          }}
        >
          {/* Header row: time labels */}
          <div className="sticky left-0 z-10 bg-surface-2 border-b border-r border-border px-3 py-2 text-xs font-medium text-text-muted">
            Table
          </div>
          {labels.map((label, i) => (
            <div key={i} className="border-b border-border px-1 py-2 text-[10px] text-text-muted text-center whitespace-nowrap">
              {i % 2 === 0 ? label : ''}
            </div>
          ))}

          {/* Table rows */}
          {uniqueTables.map((table) => {
            const tableBookings = bookingsByTable.get(table.id) || []
            return (
              <div key={table.id} className="contents">
                {/* Table name cell */}
                <div className="sticky left-0 z-10 bg-surface border-b border-r border-border px-3 py-2 text-sm font-medium text-text-strong flex items-center">
                  {table.name}
                  <span className="ml-1 text-xs text-text-muted">({table.capacity})</span>
                </div>

                {/* Slot cells with bookings */}
                {Array.from({ length: TOTAL_SLOTS }).map((_, slotIdx) => {
                  const booking = tableBookings.find((b) => timeToSlotIndex(b.startTime) === slotIdx)

                  if (booking) {
                    const span = slotSpan(booking.startTime, booking.endTime)
                    return (
                      <div
                        key={slotIdx}
                        className="border-b border-border relative"
                        style={{ gridColumn: `span ${span}` }}
                      >
                        <div className={`absolute inset-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium truncate flex items-center gap-1 ${statusColors[booking.status] || 'bg-surface-2 text-text'}`}>
                          <span className="truncate">{booking.guestName}</span>
                          <Badge tone="neutral" className="text-[9px] px-1">{booking.partySize}</Badge>
                        </div>
                      </div>
                    )
                  }

                  // Check if this slot is inside a multi-slot booking (skip rendering)
                  const isInsideBooking = tableBookings.some((b) => {
                    const start = timeToSlotIndex(b.startTime)
                    const end = start + slotSpan(b.startTime, b.endTime)
                    return slotIdx > start && slotIdx < end
                  })
                  if (isInsideBooking) return null

                  return (
                    <div
                      key={slotIdx}
                      className="border-b border-r border-border hover:bg-surface-hover transition-colors cursor-pointer"
                    />
                  )
                })}
              </div>
            )
          })}
        </div>
      </CardBody>
    </Card>
  )
}
